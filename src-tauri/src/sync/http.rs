//! HTTP-клиент для адаптеров: единые таймауты, User-Agent, обработка ошибок.

/// Клиент с таймаутом 20 с. Создавать на синк, переиспользовать внутри него.
pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("logtask/0.1")
        .build()
        .map_err(|e| format!("http-клиент: {e}"))
}

/// GET JSON с заголовками. Не-2xx → Err с кодом и началом тела.
pub async fn get_json(
    client: &reqwest::Client,
    url: &str,
    headers: &[(String, String)],
) -> Result<serde_json::Value, String> {
    let mut req = client.get(url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let resp = req.send().await.map_err(|e| format!("GET {url}: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let short: String = body.chars().take(200).collect();
        return Err(format!("GET {url}: HTTP {status}: {short}"));
    }
    resp.json()
        .await
        .map_err(|e| format!("GET {url}: невалидный JSON: {e}"))
}

/// Запрос с JSON-телом (POST/PUT/PATCH) для write-back. 2xx → Ok(()).
pub async fn send_json(
    client: &reqwest::Client,
    method: &str,
    url: &str,
    headers: &[(String, String)],
    body: &serde_json::Value,
) -> Result<(), String> {
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
        .map_err(|e| format!("{method} {url}: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let short: String = body.chars().take(200).collect();
        return Err(format!("{method} {url}: HTTP {status}: {short}"));
    }
    Ok(())
}
