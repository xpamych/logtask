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

/// GET JSON с заголовками. Не-2xx → Err с кодом и началом тела.
/// При сетевой ошибке/таймауте — один повтор (идемпотентный GET,
/// docs/specs/2026-10-04-integrations-design.md «Обработка ошибок»).
pub async fn get_json(
    client: &reqwest::Client,
    url: &str,
    headers: &[(String, String)],
) -> Result<serde_json::Value, String> {
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
                    continue; // одна повторная попытка
                }
                return Err(format!("GET {safe}: {e}"));
            }
        };
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            let short: String = body.chars().take(200).collect();
            return Err(format!("GET {safe}: HTTP {status}: {short}"));
        }
        return resp
            .json()
            .await
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
        let body = resp.text().await.unwrap_or_default();
        let short: String = body.chars().take(200).collect();
        return Err(format!("{method} {safe}: HTTP {status}: {short}"));
    }
    Ok(())
}
