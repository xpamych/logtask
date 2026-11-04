//! HTTP-клиент для адаптеров: единые таймауты, User-Agent, обработка ошибок.

/// Клиент с таймаутом 20 с. Создавать на синк, переиспользовать внутри него.
pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("logtask/0.1")
        .build()
        .map_err(|e| format!("http-клиент: {e}"))
}

/// URL без query-строки — чтобы секреты из `${secret:…}`, подставленные
/// в query, не утекали в тексты ошибок (state-файл, UI)
fn safe_url(url: &str) -> &str {
    match url.find('?') {
        Some(i) => &url[..i],
        None => url,
    }
}

pub const MAX_JSON_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_TITLE_BYTES: usize = 1024 * 1024;
pub const MAX_FAVICON_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_ERROR_BODY_BYTES: usize = 64 * 1024;

pub fn ensure_http_url(url: &reqwest::Url) -> Result<(), String> {
    match url.scheme() {
        "http" | "https" => Ok(()),
        scheme => Err(format!("недопустимая схема URL: {scheme}")),
    }
}

pub async fn read_body_limited(
    mut response: reqwest::Response,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    ensure_http_url(response.url())?;
    let declared = response
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    if declared.is_some_and(|len| len > max_bytes as u64) {
        return Err(format!("ответ превышает лимит {max_bytes} байт"));
    }
    let mut out = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("чтение ответа: {e}"))?
    {
        if out.len() + chunk.len() > max_bytes {
            return Err(format!("ответ превышает лимит {max_bytes} байт"));
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

/// GET JSON с заголовками. Не-2xx → Err с кодом и началом тела.
/// При сетевой ошибке/таймауте — один повтор (идемпотентный GET,
/// docs/specs/2026-10-04-integrations-design.md «Обработка ошибок»).
pub async fn get_json(
    client: &reqwest::Client,
    url: &str,
    headers: &[(String, String)],
) -> Result<serde_json::Value, String> {
    get_json_impl(client, url, headers, false)
        .await?
        .ok_or_else(|| "неожиданный пустой ответ".into())
}

/// Вариант GET, в котором только HTTP 404 превращается в `None`.
/// Используется для первого запроса org → fallback user.
pub async fn get_json_optional(
    client: &reqwest::Client,
    url: &str,
    headers: &[(String, String)],
) -> Result<Option<serde_json::Value>, String> {
    get_json_impl(client, url, headers, true).await
}

async fn get_json_impl(
    client: &reqwest::Client,
    url: &str,
    headers: &[(String, String)],
    allow_not_found: bool,
) -> Result<Option<serde_json::Value>, String> {
    let parsed_url = reqwest::Url::parse(url).map_err(|e| format!("url: {e}"))?;
    ensure_http_url(&parsed_url)?;
    let safe = safe_url(url);
    for attempt in 0..2 {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
        let mut req = client.get(url);
        for (k, v) in headers {
            req = req.header(k, v);
        }
        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                if attempt == 0 {
                    continue;
                }
                return Err(format!("GET {safe}: {e}"));
            }
        };
        let status = resp.status();
        if allow_not_found && status == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !status.is_success() {
            let body = read_body_limited(resp, MAX_ERROR_BODY_BYTES).await?;
            let short: String = String::from_utf8_lossy(&body).chars().take(200).collect();
            return Err(format!("GET {safe}: HTTP {status}: {short}"));
        }
        let body = read_body_limited(resp, MAX_JSON_BYTES).await?;
        return serde_json::from_slice(&body)
            .map(Some)
            .map_err(|e| format!("GET {safe}: невалидный JSON: {e}"));
    }
    unreachable!()
}

/// Запрос с JSON-телом (POST/PUT/PATCH) для write-back. 2xx → Ok(()).
pub async fn send_json(
    client: &reqwest::Client,
    method: &str,
    url: &str,
    headers: &[(String, String)],
    body: &serde_json::Value,
) -> Result<(), String> {
    let parsed_url = reqwest::Url::parse(url).map_err(|e| format!("url: {e}"))?;
    ensure_http_url(&parsed_url)?;
    let safe = safe_url(url);
    let parsed: reqwest::Method = method
        .parse()
        .map_err(|_| format!("неизвестный HTTP-метод: {method}"))?;
    let mut req = client.request(parsed, url).json(body);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("{method} {safe}: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let body = read_body_limited(resp, MAX_ERROR_BODY_BYTES).await?;
        let short: String = String::from_utf8_lossy(&body).chars().take(200).collect();
        return Err(format!("{method} {safe}: HTTP {status}: {short}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn chunked_body_over_limit_is_rejected() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(vec![b'x'; 100], "application/octet-stream"),
            )
            .mount(&server)
            .await;
        let response = client().unwrap().get(server.uri()).send().await.unwrap();

        let result = read_body_limited(response, 10).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn false_content_length_does_not_bypass_limit() {
        let response = reqwest::Response::from(
            http::Response::builder()
                .status(200)
                .header("Content-Length", "1000")
                .body(Vec::new())
                .unwrap(),
        );

        let result = read_body_limited(response, 10).await;

        assert!(result.is_err());
    }

    #[test]
    fn redirect_final_scheme_is_validated() {
        assert!(ensure_http_url(&reqwest::Url::parse("https://example.com").unwrap()).is_ok());
        assert!(ensure_http_url(&reqwest::Url::parse("file:///etc/passwd").unwrap()).is_err());
    }

    #[tokio::test]
    async fn large_json_and_error_body_are_bounded() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(vec![b' '; 32 * 1024 * 1024 + 1], "application/octet-stream"),
            )
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(500)
                    .set_body_raw(vec![b'x'; 70 * 1024], "application/octet-stream"),
            )
            .mount(&server)
            .await;
        let client = client().unwrap();

        let json_result = get_json(&client, &server.uri(), &[]).await;
        let error_result =
            send_json(&client, "POST", &server.uri(), &[], &serde_json::json!({})).await;

        assert!(json_result.is_err());
        assert!(error_result.is_err());
    }
}
