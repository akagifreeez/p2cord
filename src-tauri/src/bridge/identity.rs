use tauri::State;
use crate::services::state::DiscordState;
use crate::services::identity;

#[derive(serde::Serialize)]
pub struct LoginResponse {
    pub message: String,
    pub user_id: String,
    pub username: String,
    pub discriminator: String,
    pub avatar: Option<String>,
}

#[tauri::command]
pub async fn init_client(token: String, state: State<'_, DiscordState>) -> Result<LoginResponse, String> {
    
    // Call pure service
    let (client, user) = identity::login(token).await?;

    // Update state
    {
        let mut c = state.client.lock().unwrap();
        *c = Some(client);
    }

    // Convert Avatar Hash to URL
    let avatar_url = user.avatar.map(|hash| {
        format!("https://cdn.discordapp.com/avatars/{}/{}.png", user.id, hash)
    });

    Ok(LoginResponse {
        message: format!("Logged in as: {}#{}", user.username, user.discriminator),
        user_id: user.id,
        username: user.username,
        discriminator: user.discriminator,
        avatar: avatar_url,
    })
}
