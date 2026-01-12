pub mod p2d; // Expose existing p2d logic

use super::state::{AudioState, MediaState};
use tauri::Manager;

/// Join a P2P conference for a specific room (channel)
pub fn join_conference(app: &tauri::AppHandle, room_id: String, state: AudioState) {
    println!("Media Service: Joining conference for Room ID: {}", room_id);
    
    let media_state = app.state::<MediaState>();
    
    // 1. Abort previous session if exists
    {
        let mut session_guard = media_state.active_session.lock().unwrap();
        if let Some(session) = session_guard.take() {
            println!("Stopping previous P2P session...");
            
            // 1. Signal shutdown via flag (this allows the task to clean up properly)
            session.running_flag.store(false, std::sync::atomic::Ordering::SeqCst);
            
            // 2. Don't abort - let the task shut down gracefully so pc.close() runs
            // session.handle.abort(); // REMOVED - this was preventing cleanup
            
            // 3. Wait for cleanup (the task should close PC and exit)
            drop(session_guard); // Release lock during sleep
            std::thread::sleep(std::time::Duration::from_millis(1000)); // Increased to 1s
            
            // Re-acquire lock for new session
            let mut session_guard = media_state.active_session.lock().unwrap();
            
            // 4. Start new session
            let active_session = p2d::init(app, room_id, state);
            *session_guard = Some(active_session);
            return;
        }
        
        // No previous session - start fresh
        let active_session = p2d::init(app, room_id, state);
        *session_guard = Some(active_session);
    }
}

/// Leave the current P2P conference
pub fn leave_conference(app: &tauri::AppHandle) {
    println!("Media Service: Leaving conference");
    
    let media_state = app.state::<MediaState>();
    
    let mut session_guard = media_state.active_session.lock().unwrap();
    if let Some(session) = session_guard.take() {
        println!("Stopping P2P session...");
        
        // Signal shutdown via flag
        session.running_flag.store(false, std::sync::atomic::Ordering::SeqCst);
        
        // Release lock before waiting
        drop(session_guard);
        
        // Wait for cleanup (same as join_conference)
        std::thread::sleep(std::time::Duration::from_millis(1000));
    }
    
    println!("Conference left.");
}
