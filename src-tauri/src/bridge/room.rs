use tauri::State;
use crate::services::models::{SimpleMessage};
use crate::services::state::DiscordState;
use crate::store::DatabaseState as DbState;
use crate::services::social;



/// Command: Fetch Messages Only (Text Channel Join)
#[tauri::command]
pub async fn fetch_messages(
    guild_id: String,
    channel_id: String,
    state: State<'_, DiscordState>,
    db_state: State<'_, DbState>,
) -> Result<Vec<SimpleMessage>, String> {
    let client = {
        let c = state.client.lock().unwrap();
        c.as_ref().cloned().ok_or("Client not initialized")?
    };

    let messages = social::fetch_messages_with_guid(&client, guild_id, channel_id, None).await?;

    // Persist
    {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        crate::store::save_messages(&conn, &messages).ok();
    }

    Ok(messages)
}


