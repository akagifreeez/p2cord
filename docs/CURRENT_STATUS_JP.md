# P2Cord 現在の実装状況レポート (2026-02-16)

## 📌 プロジェクト概要
**P2Cord** - DiscordライクなUIを持つ、セキュアで低遅延なFull Mesh P2Pデスクトップ共有アプリケーション。

## 🚦 現在のステータス

### ✅ 実装完了 (Working)
*   **フロントエンド P2P (Core Logic)**
    *   現在、P2P接続・画面共有・ボイスチャットの主要ロジックは **フロントエンド (`src/hooks/useWebRTC.ts`)** に実装されています。
    *   ブラウザAPI (WebRTC) を使用して Full Mesh 接続を実現しています。
*   **ネイティブキャプチャ**
    *   Rust側 (`bridge/capture.rs`) で画面キャプチャを行い、Frontendへフレームを渡す連携は完了しています。
*   **UI/UX**
    *   **Unified RoomView**: ビデオグリッドとチャットの統合UI。
    *   **Sync Scroll**: チャンネル切り替え時の高速化。
*   **バックエンド基礎 (Rust)**
    *   `Identity` (認証) および `Social` (Discord連携) サービスは、新しい **Service/Controllerパターン** で実装済みです。

### 🚧 移行中 / 未実装 (In Progress)
*   **バックエンド P2P (Media Service)**
    *   `docs/AI_SUMMARY.md` や `ARCHITECTURE.md` に記載されている **Rust側でのWebRTC処理 (`services/media`) はまだ実装されていません**。
    *   現在は **Phase 1 (Frontend Driven)** の段階であり、今後 **Phase 2** としてロジックをRustバックエンドへ移行する計画となっています。
*   **"Room" のバックエンド実装**
    *   "Room" は現在フロントエンド上の概念としてのみ存在し、バックエンドのリソースとしては未定義です。

## 📝 次のアクション
1.  **Refactoring**: `useWebRTC.ts` の肥大化を防ぐため、ロジックの整理（Hooks分割など）を継続。
2.  **Phase 2 準備**: `services/media` の設計と実装開始（RustでのWebRTCスタック選定など）。
3.  **Documentation**: 実装と乖離していたドキュメント (`AI_SUMMARY.md`) を修正しました。

---
*このファイルは AI Agent により生成されました。*
