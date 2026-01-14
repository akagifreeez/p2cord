use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub struct DiscordState {
    pub client: Arc<Mutex<Option<reqwest::Client>>>,
}



impl DiscordState {
    pub fn new() -> Self {
        Self {
            client: Arc::new(Mutex::new(None)),
        }
    }
}
