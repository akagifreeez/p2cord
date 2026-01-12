use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use crate::services::models::DiscordUser;

const API_BASE: &str = "https://discord.com/api/v10";

pub async fn login(token: String) -> Result<(reqwest::Client, DiscordUser), String> {
    let mut headers = HeaderMap::new();
    let mut auth_val = HeaderValue::from_str(&token).map_err(|_| "Invalid token format")?;
    auth_val.set_sensitive(true);
    headers.insert(AUTHORIZATION, auth_val);

    let client = reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|e| e.to_string())?;

    let res = client.get(format!("{}/users/@me", API_BASE))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Login failed: Status {}", res.status()));
    }

    let user: DiscordUser = res.json().await.map_err(|e| format!("Json parse error: {}", e))?;

    Ok((client, user))
}
