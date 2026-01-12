use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub struct DiscordState {
    pub client: Arc<Mutex<Option<reqwest::Client>>>,
}

pub struct AudioState {
    pub is_muted: Arc<AtomicBool>,
    pub is_deafened: Arc<AtomicBool>,
}

impl AudioState {
    pub fn new() -> Self {
        Self {
            is_muted: Arc::new(AtomicBool::new(false)),
            is_deafened: Arc::new(AtomicBool::new(false)),
        }
    }
}

pub struct ActiveSession {
    pub handle: tauri::async_runtime::JoinHandle<()>,
    pub running_flag: Arc<AtomicBool>,
}

pub struct MediaState {
    pub active_session: Arc<Mutex<Option<ActiveSession>>>,
}

impl MediaState {
    pub fn new() -> Self {
        Self {
            active_session: Arc::new(Mutex::new(None)),
        }
    }
}

impl DiscordState {
    pub fn new() -> Self {
        Self {
            client: Arc::new(Mutex::new(None)),
        }
    }
}
