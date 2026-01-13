# P2Cord (with P2D Core)

**P2Cord** is a lightweight, custom Discord client built with **Tauri v2** (Rust) and **React**. It features a unique **Peer-to-Peer (P2P) Voice Chat** architecture that bypasses Discord's voice servers, offering a decentralized audio experience while maintaining standard text chat compatibility.

> **Note:** This project is in active development. The current implementation prioritizes a Discord-like UI ("P2Cord") powered by the underlying "P2D" (Peer-to-Desktop) core technologies.

## 🚀 Features

*   **Discord Integration**:
    *   View Servers (Guilds) and Channels.
    *   Read and Send Text Messages (supports Embeds and Attachments).
    *   Search Message History (Local Cache + API Fallback).
*   **P2P Voice Chat (P2D Core)**:
    *   **Full Mesh Architecture**: Direct P2P connections between users in a voice channel.
    *   **Rust-Native Audio**: Low-latency audio processing using `cpal` and `audiopus` (Opus codec) running in the Rust backend.
    *   **Custom Signaling**: Uses a local or hosted WebSocket signaling server for P2P negotiation.
    *   **Voice Activity Detection (VAD)**: Native VAD implementation.
*   **Privacy & Performance**:
    *   Lightweight resource usage compared to the official Electron client.
    *   Voice data flows directly between peers, not through Discord's voice infrastructure.

## 🛠 Tech Stack

*   **Frontend**: React 18, TypeScript, TailwindCSS, Zustand.
*   **Backend (Tauri)**: Rust.
    *   `webrtc`: Networking and P2P negotiation.
    *   `cpal`: Audio Input/Output.
    *   `audiopus`: Opus audio encoding/decoding.
    *   `rusqlite`: Local message caching.
*   **Signaling**: Node.js (WebSocket).

## 🏗 Architecture Overview

The application operates in a hybrid mode:

1.  **Text & Guilds**: The Rust backend communicates with the **Discord API** (HTTPS) to fetch guilds, channels, and messages.
2.  **Voice**: When joining a Voice Channel, the Rust backend (`services/media`) initiates a **P2P Session**:
    *   Connects to the **Signaling Server** (`ws://localhost:8080` by default).
    *   Negotiates WebRTC connections with other peers in the same channel.
    *   Exchanges audio packets directly.

## 📦 Prerequisites

*   **Node.js** (v18+) & npm/pnpm/bun
*   **Rust** (latest stable) & Cargo
*   **System Dependencies** (Linux only):
    *   `libwebkit2gtk-4.0-dev`, `build-essential`, `curl`, `wget`, `file`, `libssl-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev` (Standard Tauri deps).
    *   `libasound2-dev` (ALSA for audio).

## ⚡ Getting Started

### 1. Start the Signaling Server
The P2P voice functionality requires the signaling server to be running.

```bash
cd signaling-server
npm install
npm run dev
# Server will start on ws://localhost:8080
```

### 2. Run the Desktop App (P2Cord)
In a new terminal window, start the Tauri application:

```bash
npm install
npm run tauri dev
```

### 3. Usage
1.  **Login**: Upon launch, enter your **Discord User Token**.
    *   *Note: This is a self-bot client. Automating user accounts is against Discord TOS. Use at your own risk for educational/research purposes.*
2.  **Navigate**: Click servers on the left sidebar to view channels.
3.  **Voice Chat**: Click a **Voice Channel** to join.
    *   The app will connect to the local signaling server and establish P2P connections with other P2Cord users in the same channel.
    *   *Note: You can only hear/speak with other users running P2Cord. Standard Discord users will see you in the channel (via API) but audio will not flow to them.*
4.  **Text Chat**: Click a Text Channel to view and send messages.

## 📂 Project Structure

*   `src/`: React Frontend (UI, State Management).
    *   `App.tsx`: Main entry point and layout (Discord UI).
    *   `components/`: UI components (VoiceLayout, ChatPanel).
    *   `stores/`: Zustand stores (Session, Connection).
*   `src-tauri/`: Rust Backend.
    *   `src/bridge/`: Commands exposed to Frontend (`room.rs`, `social.rs`, `media.rs`).
    *   `src/services/media/p2d/`: **Core P2P Logic** (Audio, Signaling, WebRTC Session).
    *   `src/services/social/`: Discord API Client.
*   `signaling-server/`: Node.js WebSocket server for P2P discovery.

## 📝 Configuration

*   **Audio Devices**: Managed automatically by the OS default or backend selection logic.
*   **Signaling URL**: Hardcoded to `ws://localhost:8080` in `src-tauri/src/services/media/p2d/signaling.rs`. Modify this file to point to a remote signaling server.

## ⚠️ Known Issues / Notes

*   **Frontend WebRTC**: The codebase contains a `src/hooks/useWebRTC.ts` and `RoomView.tsx` which implement a browser-based Full Mesh P2P system. This is currently **experimental/secondary** and not the primary voice engine used in the main `App.tsx` flow.
*   **Self-Botting**: As mentioned, using a user token in a third-party client may violate Discord's Terms of Service.

