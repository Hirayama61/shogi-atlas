# shogi-atlas

自分用の将棋棋譜アトラス。棋譜を集めて分類し、局面単位で横断検索する PWA。
GitHub Pages で公開し、スマホにインストールして使う。

## 絶対に守ること

- **棋譜データをこのリポジトリにコミットしない。** テスト用フィクスチャ (`src/core/__tests__/fixtures.ts`) の短い架空の棋譜だけが例外。
  棋譜の実データは非公開の `Hirayama61/shogi-atlas-data` に置く。この PWA は公開サイトなので、ビルド成果物に棋譜が混ざると公衆送信になる。
- **将棋ウォーズや第三者サイトを自動クロールするコードを書かない。** 取得は手動 (棋譜コピー → データリポジトリの Issue に貼る) が前提。
- トークンや秘密情報をコードに埋めない。

## 構成

- `src/core/` 純粋な TypeScript。棋譜パース (`parse.ts`)、局面キー (`position.ts`)、戦型判定 (`opening.ts`)、将棋ウォーズ固有の解釈 (`wars.ts`)、共通スキーマ (`types.ts`)。DOM に依存しない。ブラウザと `scripts/` の両方から使う。
- `src/db/` Dexie (IndexedDB)。`positions` の multiEntry インデックスで局面の完全一致検索をする。
- `src/sync/` GitHub Contents API でデータリポジトリから `index.json` と `games/<id>.json` を取り込む。
- `src/ui/` React コンポーネント。ハッシュルーティング (`ui/router.ts`)。
- `scripts/process-inbox.ts` データリポジトリの Issue 受信箱を処理して `games/` と `index.json` を書く。データリポジトリ側の GitHub Actions から呼ばれる。
  運用は「対局者ごとに Issue を 1 本、タイトル = 対局者名、コメントに棋譜を貼る」。処理済みは `inbox-state.json` で管理し、Issue は閉じない。
  棋譜の取り込み経路はこれだけ。アプリ側に貼り付け取り込みは置かない (Issue 指定やラベル付けが不便なため外した)。

棋譜ライブラリは `tsshogi` (KIF / KI2 / CSA / USI / JKF の読み書き、合法手判定)。

## コマンド

```
pnpm dev          # 開発サーバー
pnpm check        # typecheck + lint + test
pnpm build        # tsc + vite build (dist/)
pnpm inbox        # Issue 受信箱の処理 (GITHUB_TOKEN, DATA_DIR が必要)
pnpm reindex      # パーサー改良後に games/*.json を raw から解析し直す (DATA_DIR が必要)
```

変更したら `pnpm check` を通してからコミットする。

## 方針

- バイブコーディングで進める。計画書や Issue を先に作らず、動くものを小さく足していく。
- 迷ったら「局面キーで対局を横断できること」を軸に考える。戦法分類・癖の抽出・分岐棋譜生成はすべてその上に乗せる。
