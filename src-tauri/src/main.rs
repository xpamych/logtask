#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match logtask_lib::shortcuts::parse_cli(&args) {
        Ok(Some(action)) => {
            if let Err(error) = logtask_lib::shortcuts::ipc::send(action) {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        Ok(None) => logtask_lib::run(),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    }
}
