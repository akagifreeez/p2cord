use tauri::{Window, State};
use crate::services::desktop::{self, MonitorInfo, ClipboardState};

#[tauri::command]
pub fn get_monitors(window: Window) -> Result<Vec<MonitorInfo>, String> {
    // Logic that depends on Window stays in Bridge or is passed to Service if possible.
    // But services/desktop was defined to take Window.
    // To be pure service, it shouldn't take Window.
    // But we are pragmatic here. We can just call the service function if it was moved there.
    // Wait, I removed get_monitors from 'services/desktop.rs' locally? NO, I didn't modify desktop.rs yet.
    // I only PLANNED to.
    
    // I'll call the service function assuming I'll strip the #[tauri::command] from it.
    desktop::get_monitors(window)
}

#[tauri::command]
pub async fn simulate_mouse_move(window: Window, x: f64, y: f64, monitor_name: Option<String>) -> Result<(), String> {
    desktop::simulate_mouse_move(window, x, y, monitor_name).await
}

#[tauri::command]
pub fn simulate_click(button: String) {
    desktop::simulate_click(button)
}

#[tauri::command]
pub fn simulate_scroll(delta_x: i32, delta_y: i32) {
    desktop::simulate_scroll(delta_x, delta_y)
}

#[tauri::command]
pub fn simulate_key(key: String) {
    desktop::simulate_key(key)
}

#[tauri::command]
pub fn write_clipboard(text: String, state: State<'_, ClipboardState>) -> Result<(), String> {
    desktop::write_clipboard(text, state)
}
