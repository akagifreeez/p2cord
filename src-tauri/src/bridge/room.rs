use tauri::State;
use crate::services::models::{SimpleMessage};
use crate::services::state::DiscordState;
use crate::store::DatabaseState as DbState;
use crate::services::social;

#[derive(serde::Serialize)]
pub struct RoomJoinResponse {
    pub messages: Vec<SimpleMessage>,
    pub p2p_active: bool,
}

/// Unified Command: Join a Room (Context + P2P)
#[tauri::command]
pub async fn join_room(
    app: tauri::AppHandle,
    guild_id: String,
    channel_id: String,
    state: State<'_, DiscordState>,
    db_state: State<'_, DbState>,
    audio_state: State<'_, crate::services::state::AudioState>
) -> Result<RoomJoinResponse, String> {
    // 1. Fetch Chat History (Social Service)
    let client = {
        let c = state.client.lock().unwrap();
        c.as_ref().cloned().ok_or("Client not initialized")?
    };

    // We fetch messages. Note: fetch_messages_with_guid also handles basic mapping.
    let messages = social::fetch_messages_with_guid(&client, guild_id.clone(), channel_id.clone(), None).await?;

    // 2. Persist to Store (Database)
    {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        crate::store::save_messages(&conn, &messages).ok();
    }

    // 3. Initialize P2P Session (Media Service)
    let audio_clone = crate::services::state::AudioState {
        is_muted: audio_state.is_muted.clone(),
        is_deafened: audio_state.is_deafened.clone(),
    };
    crate::services::media::join_conference(&app, channel_id.clone(), audio_clone);

    Ok(RoomJoinResponse {
        messages,
        p2p_active: true,
    })
}

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

/// Command: Leave the current voice room
#[tauri::command]
pub fn leave_room(
    app: tauri::AppHandle,
) -> Result<(), String> {
    crate::services::media::leave_conference(&app);
    Ok(())
}
