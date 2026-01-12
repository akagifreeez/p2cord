use tauri::State;
use crate::services::state::AudioState;
use std::sync::atomic::Ordering;

#[tauri::command]
pub fn toggle_mute(state: State<'_, AudioState>) -> bool {
    let current = state.is_muted.load(Ordering::Relaxed);
    let new_val = !current;
    state.is_muted.store(new_val, Ordering::Relaxed);
    println!("Microphone Muted: {}", new_val);
    new_val
}

#[tauri::command]
pub fn toggle_deafen(state: State<'_, AudioState>) -> bool {
    let current = state.is_deafened.load(Ordering::Relaxed);
    let new_val = !current;
    state.is_deafened.store(new_val, Ordering::Relaxed);
    println!("Speaker Deafened: {}", new_val);
    new_val
}

#[tauri::command]
pub fn get_audio_state(state: State<'_, AudioState>) -> serde_json::Value {
    let is_muted = state.is_muted.load(Ordering::Relaxed);
    let is_deafened = state.is_deafened.load(Ordering::Relaxed);
    serde_json::json!({
        "isMuted": is_muted,
        "isDeafened": is_deafened
    })
}
