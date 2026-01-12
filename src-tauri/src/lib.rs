// P2D - ライブラリモジュール
// Tauriコマンドと共通機能を定義

mod services; // 純粋なビジネスロジック (identity, social, media, desktop[logic])
mod bridge;   // Tauriコマンド (Controller)
mod store;    // データベース (Model/Cache)



use tauri::{Manager, Emitter};
use std::sync::{Arc, Mutex};
use std::env;

/// アプリケーション情報を取得するコマンド
#[tauri::command]
fn get_app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "P2D",
        "version": "0.1.0",
        "description": "P2P Desktop Sharing Application"
    })
}

/// Tauriアプリケーションを実行
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Windows向け: GPU使用を強制するWebView2追加引数
    #[cfg(target_os = "windows")]
    env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", 
        "--ignore-gpu-blocklist --enable-gpu-rasterization --enable-accelerated-video-decode"
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            // Bridge: System/Desktop
            bridge::system::get_monitors,
            bridge::system::simulate_mouse_move,
            bridge::system::simulate_click,
            bridge::system::simulate_scroll,
            bridge::system::simulate_key,
            bridge::system::write_clipboard,
            // Bridge: Identity
            bridge::identity::init_client,
            // Bridge: Social (Discord)
            bridge::social::get_guilds,
            bridge::social::get_channels,
            bridge::social::get_messages,
            bridge::social::send_message,
            bridge::social::fetch_all_history,
            bridge::social::search_discord_api,
            // Gateway (moved to bridge as it is a controller)
            bridge::gateway::start_gateway,
            
            // Bridge: Room (Unified)
            bridge::room::join_room,
            bridge::room::leave_room,
            bridge::room::fetch_messages,

            // Bridge: Media (Audio Control)
            bridge::media::toggle_mute,
            bridge::media::toggle_deafen,
            bridge::media::get_audio_state,

            // Store (Database) commands
            store::get_cached_messages,
            store::search_messages
        ])
        .setup(|app| {
            // Discord状態の初期化
            app.manage(services::state::DiscordState::new());

            // Audio状態の初期化
            app.manage(services::state::AudioState::new());
            
            // Media (P2P Session) 状態の初期化
            app.manage(services::state::MediaState::new());

            // Database状態の初期化
            let app_data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
            let db_state = store::DatabaseState::new(app_data_dir).expect("Failed to initialize database");
            app.manage(db_state);

            // クリップボード状態の初期化
            let clipboard_state = Arc::new(Mutex::new(String::new()));
            // services/desktop defines ClipboardState but it's used in bridge/system now.
            // services::desktop::ClipboardState is public struct ClipboardState(pub Arc<Mutex<String>>);
            app.manage(services::desktop::ClipboardState(clipboard_state.clone()));
            
            // クリップボード監視開始 (Logic is in services/desktop)
            services::desktop::init_clipboard(app.handle(), clipboard_state);

            // 開発時にDevToolsを開く
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                   window.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tauriアプリケーションの起動に失敗しました");
}






