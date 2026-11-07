use crate::shortcuts::ShortcutAction;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::Manager;

pub const MAX_REQUEST_BYTES: usize = 4096;
const IO_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    action: ShortcutAction,
}

#[derive(Serialize, Deserialize)]
struct Response {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug)]
pub struct IpcServer {
    path: PathBuf,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for IpcServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        let _ = UnixStream::connect(&self.path);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        let _ = fs::remove_file(&self.path);
    }
}

pub fn socket_path() -> Result<PathBuf, String> {
    let runtime = std::env::var_os("XDG_RUNTIME_DIR")
        .ok_or_else(|| "XDG_RUNTIME_DIR не задан".to_string())?;
    Ok(PathBuf::from(runtime).join("logtask.sock"))
}

pub fn parse_request(bytes: &[u8]) -> Result<ShortcutAction, String> {
    if bytes.len() > MAX_REQUEST_BYTES {
        return Err("запрос превышает 4 КиБ".to_string());
    }
    serde_json::from_slice::<Request>(bytes)
        .map(|request| request.action)
        .map_err(|error| format!("некорректный JSON: {error}"))
}

fn response(result: Result<(), String>) -> Vec<u8> {
    let response = match result {
        Ok(()) => Response {
            ok: true,
            error: None,
        },
        Err(error) => Response {
            ok: false,
            error: Some(error),
        },
    };
    serde_json::to_vec(&response).expect("сериализация ответа IPC")
}

fn peer_uid(stream: &UnixStream) -> Result<u32, String> {
    let mut credentials = libc::ucred {
        pid: 0,
        uid: 0,
        gid: 0,
    };
    let mut length = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    let result = unsafe {
        libc::getsockopt(
            std::os::fd::AsRawFd::as_raw_fd(stream),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut credentials as *mut libc::ucred).cast(),
            &mut length,
        )
    };
    if result != 0 || length as usize != std::mem::size_of::<libc::ucred>() {
        return Err(format!(
            "не удалось проверить peer credentials: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(credentials.uid)
}

fn handle_connection(
    mut stream: UnixStream,
    perform: &impl Fn(ShortcutAction),
) -> Result<(), String> {
    stream
        .set_read_timeout(Some(IO_TIMEOUT))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(IO_TIMEOUT))
        .map_err(|error| error.to_string())?;
    if peer_uid(&stream)? != unsafe { libc::geteuid() } {
        return Err("IPC доступен только текущему пользователю".to_string());
    }

    let mut bytes = Vec::new();
    (&mut stream)
        .take((MAX_REQUEST_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("ошибка чтения IPC: {error}"))?;
    let result = parse_request(&bytes).map(perform);
    stream
        .write_all(&response(result))
        .map_err(|error| format!("ошибка записи IPC: {error}"))
}

fn remove_stale_socket(path: &Path) -> Result<(), String> {
    match UnixStream::connect(path) {
        Ok(_) => Err(format!(
            "Logtask уже запущен: активный socket {}",
            path.display()
        )),
        Err(connect_error) => {
            let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
            if !metadata.file_type().is_socket() || metadata.uid() != unsafe { libc::geteuid() } {
                return Err(format!(
                    "путь IPC занят посторонним файлом: {}",
                    path.display()
                ));
            }
            fs::remove_file(path).map_err(|error| {
                format!(
                    "не удалось удалить stale socket после ошибки подключения {connect_error}: {error}"
                )
            })
        }
    }
}

fn validate_runtime_dir(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "некорректный путь IPC".to_string())?;
    let metadata = fs::symlink_metadata(parent)
        .map_err(|error| format!("каталог IPC {} недоступен: {error}", parent.display()))?;
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || metadata.uid() != unsafe { libc::geteuid() }
    {
        return Err(format!(
            "каталог IPC должен принадлежать текущему пользователю: {}",
            parent.display()
        ));
    }
    Ok(())
}

pub fn listen_at(
    path: &Path,
    perform: impl Fn(ShortcutAction) + Send + 'static,
) -> Result<IpcServer, String> {
    validate_runtime_dir(path)?;
    if path.exists() {
        remove_stale_socket(path)?;
    }
    let listener = UnixListener::bind(path)
        .map_err(|error| format!("не удалось создать socket {}: {error}", path.display()))?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("не удалось установить socket 0600: {error}"))?;

    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop);
    let thread = std::thread::Builder::new()
        .name("logtask-shortcut-ipc".to_string())
        .spawn(move || {
            for stream in listener.incoming() {
                if thread_stop.load(Ordering::Acquire) {
                    break;
                }
                match stream {
                    Ok(stream) => {
                        if let Err(error) = handle_connection(stream, &perform) {
                            log::warn!("ошибка локального IPC: {error}");
                        }
                    }
                    Err(error) => log::warn!("ошибка accept локального IPC: {error}"),
                }
            }
        })
        .map_err(|error| format!("не удалось запустить IPC listener: {error}"))?;
    Ok(IpcServer {
        path: path.to_path_buf(),
        stop,
        thread: Some(thread),
    })
}

pub fn listen(app: &tauri::AppHandle) -> Result<(), String> {
    let path = socket_path()?;
    let app_for_action = app.clone();
    let server = listen_at(&path, move |action| action.perform(&app_for_action))?;
    *app.state::<crate::state::AppState>().shortcut_ipc.lock() = Some(server);
    Ok(())
}

pub fn send(action: ShortcutAction) -> Result<(), String> {
    send_to(&socket_path()?, action)
}

pub fn send_to(path: &Path, action: ShortcutAction) -> Result<(), String> {
    let mut stream = UnixStream::connect(path)
        .map_err(|error| format!("не удалось подключиться к Logtask: {error}"))?;
    stream
        .set_read_timeout(Some(IO_TIMEOUT))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(IO_TIMEOUT))
        .map_err(|error| error.to_string())?;
    let request = serde_json::to_vec(&Request { action }).expect("сериализация запроса IPC");
    stream
        .write_all(&request)
        .map_err(|error| format!("не удалось отправить команду: {error}"))?;
    stream
        .shutdown(std::net::Shutdown::Write)
        .map_err(|error| error.to_string())?;

    let mut bytes = Vec::new();
    (&mut stream)
        .take((MAX_REQUEST_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("не удалось получить ответ Logtask: {error}"))?;
    let response: Response = serde_json::from_slice(&bytes)
        .map_err(|error| format!("некорректный ответ Logtask: {error}"))?;
    if response.ok {
        Ok(())
    } else {
        Err(response
            .error
            .unwrap_or_else(|| "Logtask отклонил команду".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::{listen_at, parse_request, send_to, MAX_REQUEST_BYTES};
    use crate::shortcuts::ShortcutAction;
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::UnixListener;
    use std::path::PathBuf;
    use std::sync::mpsc;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn socket_path(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("logtask-ipc-{name}-{}-{nonce}", std::process::id()));
        std::fs::create_dir(&dir).unwrap();
        dir.join("ipc.sock")
    }

    #[test]
    fn json_request_is_validated_and_limited() {
        assert_eq!(
            parse_request(br#"{"action":"new-task"}"#).unwrap(),
            ShortcutAction::NewTask
        );
        assert!(parse_request(br#"{"action":"unknown"}"#).is_err());
        assert!(parse_request(br#"{"action":"open","extra":true}"#).is_err());

        let oversized = vec![b' '; MAX_REQUEST_BYTES + 1];
        assert!(parse_request(&oversized).is_err());
    }

    #[test]
    fn socket_performs_request_response() {
        let path = socket_path("roundtrip");
        let (tx, rx) = mpsc::channel();
        let server = listen_at(&path, move |action| tx.send(action).unwrap()).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);

        send_to(&path, ShortcutAction::Today).unwrap();
        assert_eq!(rx.recv().unwrap(), ShortcutAction::Today);

        drop(server);
        assert!(!path.exists());
        std::fs::remove_dir(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn stale_socket_is_replaced() {
        let path = socket_path("stale");
        let stale = UnixListener::bind(&path).unwrap();
        drop(stale);
        assert!(path.exists());

        let server = listen_at(&path, |_| {}).unwrap();
        send_to(&path, ShortcutAction::Open).unwrap();

        drop(server);
        assert!(!path.exists());
        std::fs::remove_dir(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn active_socket_rejects_second_listener() {
        let path = socket_path("active");
        let server = listen_at(&path, |_| {}).unwrap();
        let error = listen_at(&path, |_| {}).unwrap_err();
        assert!(error.contains("уже"), "unexpected error: {error}");

        drop(server);
        assert!(!path.exists());
        std::fs::remove_dir(path.parent().unwrap()).unwrap();
    }
}
