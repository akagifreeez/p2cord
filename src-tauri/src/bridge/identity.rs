use tauri::State;
use crate::services::state::DiscordState;
use crate::services::identity;

#[tauri::command]
pub async fn init_client(token: String, state: State<'_, DiscordState>) -> Result<String, String> {
    
    // Call pure service
    let (client, user) = identity::login(token).await?;

    // Update state
    {
        let mut c = state.client.lock().unwrap();
        *c = Some(client);
    }

    Ok(format!("Logged in as: {}#{}", user.username, user.discriminator))
}
