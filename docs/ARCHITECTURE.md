# P2Cord アーキテクチャ設計書 (Target Architecture)

> [!IMPORTANT]
> **Work in Progress**: 本ドキュメントは目指すべき「あるべき姿（Target Architecture）」を記述しています。
> 現在の実装コード（`src-tauri/src/services/` 等）はこの設計への移行途中であり、一部乖離が存在します。

## 1. 設計思想: "Room" という抽象化

従来、「Discordクライアントの中にP2P機能がある」という構造でしたが、新アーキテクチャでは **「Room（部屋）」** という共通の抽象化概念の上に、ソーシャル機能（Discord）とメディア機能（P2P）を統合します。

### Roomの定義
Discordの「テキストチャンネル」や「ボイスチャンネル」を、アプリ内では単一の **Room** リソースとして扱います。

*   **Metadata (Social Layer)**:
    *   Discord APIから取得したチャンネル名、トピック、参加者リスト。
    *   権限管理、ユーザー認証。
*   **Media Session (P2P Layer)**:
    *   その部屋で進行中のWebRTCセッション（ボイスチャット、画面共有）。
    *   参加者間のFull Mesh接続。
*   **Context**:
    *   チャット履歴（ローカルキャッシュ + API取得）。
    *   現在の参加者のステータス。

---

## 2. バックエンド構成 (Rust)

モノリシックな構造を脱却し、責務ごとにサービスを分離した「コントローラーパターン」を採用します。

### ディレクトリ構造 (Target)
```
src-tauri/src/
├── services/
│   ├── identity/        # 認証・ユーザー情報 (Discord API / OAuth2)
│   ├── social/          # サーバー・チャンネル・メッセージ (Discord Gateway / REST)
│   └── media/           # P2P共有・音声通信 (P2D Core / WebRTC / cpal)
├── store/               # SQLite / Key-Value Store (キャッシュ・設定)
└── bridge/              # Tauri Commands (Frontendとの接点 / Controller)
```

### 各サービスの責務
*   **Identity Service**: ユーザーの認証トークン管理、自分のプロファイル情報の維持。
*   **Social Service**: Discordサーバー/チャンネル情報の取得、メッセージの送受信、Gatewayイベントのハンドリング。
*   **Media Service**:
    *   WebRTC PeerConnectionの管理。
    *   オーディオ/ビデオデバイスの制御（`cpal`, `arboard`）。
    *   シグナリング処理。
*   **Bridge (Controller)**:
    *   フロントエンドからの `invoke` を受け取り、複数のサービスをオーケストレーションします。
    *   例: `join_room` コマンド → Socialサービスで履歴取得 ＋ MediaサービスでP2P接続開始。

---

## 3. 通信アーキテクチャ

### 3.1 P2Pネットワーク (Media Layer)
*   **トポロジー**: Full Mesh（全参加者間での直接接続）。サーバー負荷を回避し、低遅延を実現。
*   **シグナリング**: 独自のWebSocketサーバー（`signaling-server/`）を使用。
    *   DiscordのチャンネルIDをRoom IDとして利用し、同じチャンネルにいるユーザー同士をマッチングします。
    *   Discordのボイスサーバー（RTC）は使用せず、純粋なP2Pで音声をやり取りします（軽量クライアントの核）。

### 3.2 プロトコル詳細
*   **映像/音声**: SRTP (Secure Real-time Transport Protocol)
*   **データ**: SCTP over DTLS (DataChannel)
    *   **用途**:
        *   `input:mouse/keyboard`: リモートデスクトップ操作信号。
        *   `chat:message`: P2Pベースのテキストチャット（Discord APIダウン時のバックアップ等）。
        *   `stats`: 接続品質情報の交換。

### 3.3 メディアパイプラインとコーデック
GPUアクセラレーションを最大限活用し、低負荷・高画質を目指します。

*   **優先コーデック順位**:
    1.  **AV1** (高圧縮・高品質 / RTX 40系, Intel Arc, Apple Silicon等でHWエンコード推奨)
    2.  **H.265 (HEVC)**
    3.  **H.264 (AVC)**
*   **非機能要件（目標値）**:
    *   **遅延**: LAN環境 < 50ms, WAN環境 < 200ms
    *   **解像度**: 最大 4K (3840x2160)
    *   **フレームレート**: 最大 120fps (設定により 15/30/60/120 可変)

---

## 4. フロントエンド構成 (React + Tauri)

### 4.1 ステート管理 (Zustand)
巨大な `App.tsx` のStateを廃止し、**「現在の通信コンテキスト」** を管理するストアへ移行します。

*   **ActiveSessionStore**:
    *   `currentRoomId`: 現在アクティブなRoom ID。
    *   `mediaState`: 接続中（Connected）、接続試行中（Connecting）、切断（Disconnected）。
    *   `peers`: 参加中のピア情報マップ。

### 4.2 UXデザイン: P2P-First
*   **メインエリア**: 「今、行われている対話」を最優先。
    *   画面共有中はビデオキャンバスを最大化。
    *   ボイスチャット中はアバターと波形ビジュアライザーを表示。
*   **サイドバー**: ナビゲーション（Discordサーバー/チャンネル一覧）。
*   **Sync Scroll**: チャンネル切り替え時の体感ラグをゼロにするための `useLayoutEffect` による同期的スクロール制御（詳細は `DEV_GUIDELINE.md` 参照）。

---

## 5. ロードマップと移行フェーズ

1.  **Phase 1 (Performance)**: フロントエンドのレンダリング最適化（Sync Scroll, Visibility制御）。
2.  **Phase 2 (Refactoring)**: Rustバックエンドのサービス分離（`services/media` の確立）。
3.  **Phase 3 (Integration)**: DiscordチャンネルIDをキーとした完全な自動P2P接続の実装。
