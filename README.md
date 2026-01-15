# P2Cord - Lightweight Discord Alternative

<p align="center">
  <img src="public/p2d-icon.svg" width="120" height="120" alt="P2Cord Logo">
  <br>
  <strong>Discord風UIを持つ、軽量P2Pボイスチャットアプリケーション</strong>
  <br>
  <em>Tauri v2 + React + WebRTC</em>
</p>

## 概要

P2Cord（ピーツーコード）は、Discordライクなモダンなインターフェースを持つ、軽量なP2Pボイスチャットアプリケーションです。

**P2Cord** = P2P + Discord の略称で、中央サーバーに依存しない分散型のコミュニケーションを実現します。

## ✨ 主な機能

### 🎙️ P2Pボイスチャット & 画面共有
- **低遅延通話**: WebRTCによる直接P2P接続
- **Opus音声コーデック**: 高品質な音声圧縮
- **Voice Activity Detection**: 発話検出とUIフィードバック
- **マルチモニター同時配信**: 複数の画面を同時に共有可能。ドロップダウンから「別の画面を追加」を選択。
- **柔軟なレイアウト表示**: 受信画面の表示方法を3モードで切り替え可能
    - **Auto**: 新規配信を自動フォーカス、他は下部フィルムストリップに表示
    - **Grid**: 全画面を均等グリッド表示
    - **Side-by-Side**: 配信画面を横並びで表示
- **トラック単位フォーカス**: 同一相手の複数配信から特定画面のみを拡大表示
- **高画質設定**: AV1コーデック対応、最大120fps、画質プリセット機能
- **自動再接続**: ハートビートによる接続断検知と自動リカバリー

### 💬 Discord連携 & ユーティリティ
- **リアルタイムチャット**: メッセージ受信を即座に反映 (Gateway API)
- **サーバー/チャンネル表示**: Discordのサーバーとチャンネルを完全同期
- **メッセージ履歴**: テキストチャンネルの過去ログ・画像表示・ページネーション対応
- **ウィンドウ配置管理**: 終了時の位置(座標/サイズ/モニター)を記憶し次回自動復元
- **マルチモニター間高速移動**: ショートカットキーでウィンドウを隣のモニターへ瞬時に移動
    - `Ctrl + Shift + →`: 次のモニターへ移動
    - `Ctrl + Shift + ←`: 前のモニターへ移動
- **クリップボード監視**: 画像URLのコピーを検知してプレビュー (オプション)

### 🎨 モダンUI
- **Cyberpunk Glassテーマ**: ダークモード + 超軽量グラスモーフィズム
- **Discord風レイアウト**: サーバー/チャンネル/メッセージの直感的なパネル構成
- **インタラクティブ状態表示**: 接続状態、発信者、共有画面のリアルタイム可視化

## 🛠️ 技術スタック

| Layer         | Technology                              |
| ------------- | --------------------------------------- |
| **Frontend**  | React 18, TypeScript, Vite, TailwindCSS |
| **Backend**   | Tauri v2 (Rust)                         |
| **Audio**     | cpal, opus (Rust crates)                |
| **P2P**       | webrtc-rs (Rust WebRTC implementation)  |
| **Signaling** | Node.js WebSocket Server                |
| **State**     | Zustand                                 |

## 📁 プロジェクト構造

```
p2cord/
├── src/                    # React Frontend
│   ├── App.tsx            # メインアプリケーション
│   ├── components/        # UIコンポーネント
│   │   └── VoiceLayout.tsx  # ボイスチャットUI
│   └── stores/            # Zustand状態管理
│       └── sessionStore.ts  # セッション状態
│
├── src-tauri/             # Rust Backend
│   └── src/
│       ├── services/
│       │   ├── media/     # P2Pメディアサービス
│       │   │   └── p2d/   # P2Dコアモジュール
│       │   │       ├── mod.rs       # 初期化 & 再接続ループ
│       │   │       ├── session.rs   # WebRTC PeerConnection
│       │   │       ├── signaling.rs # シグナリングメッセージ
│       │   │       └── audio.rs     # Opusエンコード/デコード
│       │   └── social/    # Discord API連携
│       └── bridge/        # Tauriコマンド
│
└── signaling-server/      # シグナリングサーバー
    └── server.js          # WebSocket Server
```

## 🚀 セットアップ

### 前提条件

- **Node.js** v18以上
- **Rust** 最新安定版
- **Windows**: Visual Studio Build Tools (C++)

### インストール

```bash
# リポジトリをクローン
git clone https://github.com/your-repo/p2cord.git
cd p2cord

# 依存関係をインストール
npm install

# シグナリングサーバーの依存関係
cd signaling-server && npm install && cd ..
```

### 開発サーバー起動

```bash
# ターミナル1: シグナリングサーバー
node signaling-server/server.js

# ターミナル2: Tauriアプリ
npm run tauri dev
```

## ⚙️ アーキテクチャ

### P2D (P2P Desktop) コアモジュール

```
┌─────────────────┐       WebSocket        ┌──────────────────┐
│   Client A      │◄─────────────────────►│ Signaling Server │
│  (p2d/mod.rs)   │                        └──────────────────┘
└────────┬────────┘                                 ▲
         │                                          │
    WebRTC (P2P)                                    │
         │                                          │
         ▼                                          │
┌─────────────────┐       WebSocket        ┌───────┴──────────┐
│   Client B      │◄─────────────────────►│                   │
│  (p2d/mod.rs)   │                        └───────────────────┘
└─────────────────┘
```

### シグナリングメッセージ

| Message        | Description             |
| -------------- | ----------------------- |
| `Join`         | ルーム参加通知          |
| `Welcome`      | 参加者への応答          |
| `Leave`        | ルーム退出通知          |
| `Offer`        | WebRTC SDP Offer        |
| `Answer`       | WebRTC SDP Answer       |
| `IceCandidate` | ICE候補交換             |
| `Ping`         | ハートビート（2秒間隔） |

### ハートビート & 再接続

- **Ping送信**: 2秒間隔
- **タイムアウト検知**: 6秒間Pingがなければ切断と判定
- **自動リカバリー**: PeerConnectionを再作成して再接続

## 📜 ライセンス

MIT License
