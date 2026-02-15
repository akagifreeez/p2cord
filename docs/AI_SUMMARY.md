# P2D (P2P Desktop Sharing) Project Context

## Documentation Hierarchy (Updated 2026-01-15)
*   **`docs/AI_SUMMARY.md`**: This file. Current status and context.
*   **`docs/ARCHITECTURE.md`**: Target system architecture (Room concept, Service layer).
*   **`docs/DEV_GUIDELINE.md`**: UX/Performance guidelines and coding standards.
*   **`docs/ROADMAP.md`**: Detailed feature roadmap and backlog.
*   **`docs/archive/`**: Archived specifications and temporary files.

## Overview
P2D is a secure, low-latency **Full Mesh Peer-to-Peer** desktop sharing application built with Tauri v2, React, and WebRTC.
It features multi-peer screen sharing, voice chat (microphone), text chat, and a premium "Cyberpunk Glass" UI.

## Tech Stack
*   **Frontend**: React 18, TypeScript, Vite, TailwindCSS
*   **Backend**: Tauri v2 (Rust), `enigo` (Input Simulation), `arboard` (Clipboard)
*   **Communication**: WebRTC (Full Mesh P2P), WebSocket (Signaling)
*   **Design System**: Custom "Cyberpunk Glass" theme

---

## Architecture (Full Mesh P2P - Updated 2026-01-12)

### 1. Signaling Server (`signaling-server/`)
*   **Server**: Node.js WebSocket server.
*   **Protocol**: JSON-based messages.
*   **Key Messages**:
    *   `room:create` / `room:created`: ルーム作成
    *   `room:join` / `room:joined`: ルーム参加（既存参加者リストを返す）
    *   `peer:joined`: 新規参加者通知（既存メンバー向け）
    *   `peer:offer`, `peer:answer`, `peer:ice-candidate`: WebRTCシグナリング
*   **特徴**: Host/Viewer区別なし。全員が対等な参加者（`participants` Map）。

### 2. WebRTC Implementation (`src/hooks/useWebRTC.ts`)
*   **接続モデル**: Full Mesh（全参加者間で直接P2P接続）
*   **状態管理**:
    *   `participants: Map<string, ParticipantInfo>`: 全参加者情報
    *   `remoteStreams: Map<string, MediaStream>`: 各ピアからの受信ストリーム
    *   `localStream`: 自分の画面共有ストリーム
*   **主要機能**:
    *   `createRoom(name)` / `joinRoom(code, name)`: ルーム操作
    *   `startScreenShare()` / `stopScreenShare()`: 画面共有
    *   `startMicrophone()` / `stopMicrophone()` / `toggleMute()`: マイク制御
    *   `sendChatMessage(text)`: チャット送信（DataChannel経由）
*   **ピア接続フロー**:
    1. 新規参加者がJoin → `room:joined` で既存参加者リスト受信
    2. 新規は各既存ピアに対してOffer送信（Initiator）
    3. 既存は `peer:joined` 受信 → Answer待ち（Receiver）

### 3. UI Components (`src/components/`)
| Component       | Description                                                    |
| --------------- | -------------------------------------------------------------- |
| `RoomView.tsx`  | **メイン画面**。入室フロー + ビデオグリッド + コントロールバー |
| `ChatPanel.tsx` | テキストチャット（サイドバー統合）                             |
| `VideoGridItem` | 各ピアのビデオ表示カード                                       |
| `App.tsx`       | ルーティング、設定管理                                         |

### 4. Control Bar Features
| Button           | State               | Behavior                       |
| ---------------- | ------------------- | ------------------------------ |
| **Screen Share** | OFF/ON              | 画面共有開始/停止              |
| **Microphone**   | OFF/ON (Green)      | マイク開始/停止                |
| **Mute**         | Unmuted/Muted (Red) | マイクON時に表示、ミュート切替 |
| **Settings**     | -                   | 設定モーダル表示               |
| **Leave**        | -                   | ルーム退出                     |

---

## Key Directories & Files
```
src/
├── App.tsx              # Entry, routing, settings
├── components/
│   ├── RoomView.tsx     # Main unified room view (NEW)
│   └── ChatPanel.tsx    # Text chat panel
├── hooks/
│   └── useWebRTC.ts     # Core WebRTC logic (Full Mesh)
├── lib/
│   ├── signalingClient.ts  # WS client wrapper
│   └── dataChannel.ts      # Type definitions
├── stores/
│   └── connectionStore.ts  # Zustand state
└── styles/
    └── index.css        # Cyberpunk Glass theme

signaling-server/
├── src/
│   ├── index.ts         # WS server entry
│   ├── roomManager.ts   # Room/Participant management
│   └── types.ts         # Shared types
```

---

## Current Status (2026-02-16)

### ✅ Completed
*   **Full Mesh P2P Architecture**: Host/Viewer区別を廃止、対等なピア接続
*   **Multi-Peer Screen Sharing**: 複数人の画面を同時表示可能
*   **Microphone Support**: マイクON/OFF、ミュート、デバイス選択
*   **Voice Activity Detection (VAD)**: 発話検出でアバターがハイライト、DataChannel経由でリモート共有
*   **TURN Server Configuration**: 設定画面でTURN URL/Username/Credentialを指定可能（localStorage永続化）
*   **Unified RoomView UI**: ビデオグリッド、参加者リスト、チャット統合、接続品質表示
*   **Refactoring & Cleanup**: TypeScriptエラーの一括修正、不要ファイルの削除
*   **Heartbeat & Reconnection**: `Ping`メッセージによるハートビート、自動リカバリー、`leave_room`実装
*   **Discord Integration Update (2026-01-14)**:
    *   **Forum & Thread Support**: フォーラム、アーカーブスレッド、アクティブスレッドの取得・表示対応
    *   **Search API Fallback**: アクティブスレッド取得時のBot権限回避策としてSearch APIを使用
    *   **Thread/Channel Sorting**: `last_message_id` による最新更新順ソートと5日以内フィルタリング
*   **Voice Chat UI Overhaul (2026-01-14)**:
    *   **Integrated ChannelChat**: `ChatPanel` を廃止し、`ChannelChat` 共通コンポーネントを作成
    *   **Split Layout**: ボイスチャット画面をビデオグリッドとチャットの左右分割レイアウトに変更
    *   **Message Sync Fix**: ボイスチャンネル参加時のメッセージ履歴読み込みバグ修正
    *   **Rich Content & Scrolling**: 画像・Embed表示対応、上スクロールによる過去ログ読み込み(Pagination)対応
*   **Feature Updates (2026-01-15)**:
    *   **Focused View**: 画面共有/話者の自動拡大、クリックによるフォーカス切替
    *   **Real-time Chat**: Discord Gateway連携によるメッセージ即時反映
    *   **Stream Quality**: 
        *   AV1コーデック優先ロジック（安定化済み）
        *   画質設定UI（1080p/720p/Native, 15/30/60/**120fps**）
        *   Adaptive Bitrate Control連携
    *   **Gateway Member List (OP 14)**: 
        *   Discord公式と同様のLazy Request実装
        *   メンバー一覧リアルタイム取得
        *   プレゼンス表示（オンライン/離席/DND/オフライン）
        *   アクティビティ表示（Playing X, Listening to Y）
    *   **Multi-Monitor & Screen Share Overhaul (2026-01-15/16)**:
        *   **Native Browser Capture**: カスタムキャプチャ（Tauri経由）を廃止し、ブラウザネイティブの`getDisplayMedia`に一本化。60+ FPS、低CPU負荷、高画質を実現。
        *   **Add Share Dropdown**: 画面共有ボタンを押すとドロップダウンメニューが表示され、「別の画面を追加」「すべての共有を停止」が選択可能。複数モニター同時配信に対応。
        *   **Flexible Layout Modes**: ヘッダーにレイアウト切替ボタンを追加。
            *   **Auto**: 新規配信を自動フォーカス
            *   **Grid**: 全画面を均等グリッド表示
            *   **Side-by-Side**: 配信画面を横並びで表示
        *   **Track-Level Focus**: 同一ピアの複数ストリームを個別に管理。フォーカス時も他のストリームはフィルムストリップに表示。
        *   **Filmstrip Enhancement**: フォーカス時に下部へ他ストリーム・参加者を横並び表示。
    *   **Slash Command Implementation (2026-01-16)**:
        *   **Client-Side Commands**: `/clear`, `/help`, `/echo` 等のクライアントサイドコマンドを実装。
        *   **Custom Parser & Registry**: 引数パース、コマンド登録、Markdownレンダリング（太字、斜体、スポイラー等）の基盤を整備。
        *   **Bot Command Integration**: Discord Application Commandを統合し、ピッカー上での補完と引数付き実行に対応。

### 🔄 In Progress / TODO
*   リモートコントロール（マウス/キーボード）のFull Mesh対応
*   さらなる低遅延化に向けたキャプチャレートの動的調整機能

### ⚠️ Known Issues
*   **OP 14非公式API**: Gateway OP 14は非公式なため、Discord側の変更で動かなくなる可能性あり
*   **Rate Limits**: コマンド連打時に429 Too Many Requestsが発生する場合がある

---

## Key P2D Architecture (Rust Backend - Planned / In Progress)
> [!NOTE]
> Currently, P2P logic is implemented in Frontend (`src/hooks/useWebRTC.ts`).
> The following backend structure is the **Target Architecture** for Phase 2. `services/media` is currently under research/development.

### services/media/p2d/ (Planned)
| File           | Description                                                    |
| :------------- | :------------------------------------------------------------- |
| `mod.rs`       | P2D初期化、再接続ループ、ハートビート、オーディオ管理          |
| `session.rs`   | WebRTC PeerConnection管理、トラック設定                        |
| `signaling.rs` | シグナリングメッセージ定義（Join/Leave/Offer/Answer/Ice/Ping） |
| `audio.rs`     | Opusエンコード/デコード、cpalによる入出力                      |

### services/media/mod.rs (Planned)
*   `join_conference`: P2Pセッション開始
*   `leave_conference`: P2Pセッション終了

### bridge/room.rs (Implemented)
*   `fetch_messages`: チャット履歴取得 (P2P開始トリガーは現在Frontend側で制御)


---

## Instructions for AI Agents
1.  **Read First**: Check `GEMINI.md` for role definitions.
2.  **Context Loading**: Read this file (`AI_SUMMARY.md`) at the start of every session.
3.  **Documentation**:
    *   Follow `docs/ARCHITECTURE.md` for system design.
    *   Follow `docs/DEV_GUIDELINE.md` for coding standards.
4.  **Style Consistency**: Cyberpunk Glass theme (`glass-card`, `btn-primary`, `text-cyan-400`).
5.  **Code Safety**:
    *   Caution with `p2d/mod.rs` (audio/reconnection loops).
    *   Restart `tauri dev` after Rust changes.

