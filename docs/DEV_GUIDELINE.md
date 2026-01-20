# P2Cord 開発・改善ガイドライン

本ドキュメントは、P2Cordプロジェクトにおける実装ルール、UX改善手法、および技術スタックを定義します。開発者は本ガイドラインに従い、高品質かつレスポンシブなアプリケーションを構築してください。

## 1. UX/パフォーマンス改善ガイドライン

Discord本家を超える「キレのある操作感」を実現するため、以下の実装パターンを徹底します。

### 1.1 チャンネル切り替えの高速化 (Sync Scroll)

メッセージリストのスクロール位置復元には、`useEffect` や `requestAnimationFrame` を使用してはいけません。これらは描画後（Paint後）に実行されるため、ユーザーに一瞬のチラつき（Flash of Unstyled Content）を見せてしまいます。

**推奨実装: `useLayoutEffect` による同期的制御**

ブラウザが画面を描画する前（DOM更新直後）にスクロール位置を確定させます。

```typescript
useLayoutEffect(() => {
    if (isSwitchingChannel) {
        const container = messagesContainerRef.current;
        if (container) {
            // behavior: 'smooth' は使用せず、DOMプロパティに直接代入する
            container.scrollTop = container.scrollHeight;

            // 即座にスイッチングフラグを解除し、表示可能な状態にする
            setIsSwitchingChannel(false);
        }
    }
}, [messages, isSwitchingChannel]); // messages更新時に発火
```

### 1.2 視覚的連続性の確保 (No Black Curtain)

ロード中であることを隠すために画面全体を真っ黒なオーバーレイで覆う（Iron Curtain）手法は廃止します。これはユーザーに「待たされている感」を与えます。

*   **ルール**: `isSwitchingChannel` が `true` の間、チャットエリアのみを `visibility: hidden` に設定します。
*   **効果**: サイドバーやヘッダーは維持されたまま、メッセージリストだけが「一瞬消えて、最新の位置でパッと現れる」挙動となり、アプリが停止したような印象を与えません。

### 1.3 レイアウトシフト (CLS) の防止

画像の読み込み遅延によるスクロール位置のズレ（ガクつき）を防止するため、画像要素には必ずサイズを指定します。

*   **ルール**: Discord APIから取得した `width` と `height` を `img` タグの属性として明示します。
*   **効果**: 画像データが届く前からブラウザがスペースを確保できるため、スクロール位置計算が狂いません。

```tsx
<img
  src={attachment.url}
  width={attachment.width}
  height={attachment.height}
  className="rounded-md"
  loading="lazy"
/>
```

---

## 2. 技術スタック

### Frontend
*   **Core**: React 18, TypeScript
*   **Build**: Vite
*   **Styling**: TailwindCSS
*   **State Management**: Zustand (グローバルな通信状態の管理)
*   **Communication**: WebRTC (Browser API), WebSocket (Signaling)

### Backend (Tauri)
*   **Core**: Tauri v2, Rust
*   **Async Runtime**: Tokio
*   **Media**:
    *   `cpal`: 低レイテンシオーディオ入出力
    *   `webrtc` (crate): P2P通信のネイティブ処理
    *   `arboard`: クリップボード操作
    *   `enigo`: 入力シミュレーション（リモートコントロール）

---

## 3. 実装上の注意点

1.  **IPC通信の最適化**:
    *   Rust側への `invoke` は非同期でコストがかかります。頻繁な呼び出し（例：マウス移動ごとのイベント）は避け、バッチ処理やDataChannel経由の通信を検討してください。
2.  **メモリ管理**:
    *   WebRTCの `MediaStream` や `PeerConnection` は、不要になったら確実に `close()` し、リファレンスを破棄してください。コンポーネントのアンマウント時 (`useEffect` の cleanup) での処理を徹底してください。
3.  **エラーハンドリング**:
    *   P2P接続は不安定になることを前提に実装してください。ICE Connection State の変化を監視し、`disconnected` や `failed` 時に自動再接続を試みるロジック（Ice Restart）を組み込んでください。
