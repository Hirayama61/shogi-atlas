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
- `src/core/normalize.ts` 古いレコードを現在の型に揃える。`src/core/stats.ts` 対局者ごとの集計と分岐点。
- `src/db/` Dexie (IndexedDB)。`positions` の multiEntry インデックスで局面の完全一致検索をする。読み出し時に normalize を通す。
- `src/sync/` GitHub Contents API でデータリポジトリから `index.json` と `games/<id>.json` を取り込む。
- `src/ui/` React コンポーネント。ハッシュルーティング (`ui/router.ts`)。
- `src/core/analysis.ts` エンジン解析の型と各手の評価 (損失・勝率の減少・疑問手/悪手/大悪手)。`src/core/profile.ts` 対局者の弱点プロファイル。`src/core/annotate.ts` 解析つき KIF。
- `scripts/engine.ts` やねうら王 (WebAssembly, `@mizarjp/yaneuraou.k-p`) の USI ラッパー。`scripts/analyze.ts` がデータリポジトリの未解析の対局を解析して `analysis/<id>.{json,kif}` を書き、`scripts/profile.ts` が `players/<name>/profile.{json,md}` と `analysis/index.json` を書く。データリポジトリ側の `analyze.yml` から毎日呼ばれる。
- `scripts/process-inbox.ts` データリポジトリの Issue 受信箱を処理して `games/` と `index.json` を書く。データリポジトリ側の GitHub Actions から呼ばれる。
  運用は「対局者ごとに Issue を 1 本、タイトル = 対局者名、コメントに棋譜を貼る」。処理済みは `inbox-state.json` で管理し、Issue は閉じない。
  棋譜の取り込み経路はこれだけ。アプリ側に貼り付け取り込みは置かない (Issue 指定やラベル付けが不便なため外した)。

棋譜ライブラリは `tsshogi` (KIF / KI2 / CSA / USI / JKF の読み書き、合法手判定)。

週次の「対策レポート」は Claude のルーティン (専用セッションに毎週月曜 05:52 JST に起動) が書く。
入力はデータリポジトリの `players/<name>/profile.md` と `analysis/*.kif`、出力は `players/<name>/report.md`。本体には何もコミットしない。

## コマンド

```
pnpm dev          # 開発サーバー
pnpm check        # typecheck + lint + format:check + test
pnpm e2e          # Playwright (要 pnpm build)。GitHub API はモックし、同期から分岐点まで通す
pnpm test:coverage
pnpm build        # tsc + vite build (dist/)
pnpm inbox        # Issue 受信箱の処理 (GITHUB_TOKEN, DATA_DIR が必要)
pnpm reindex      # パーサー改良後に games/*.json を raw から解析し直す (DATA_DIR が必要)
pnpm analyze      # エンジン解析 (DATA_DIR, DEPTH, MAX_GAMES, ONLY)
pnpm build-profiles  # 弱点プロファイルと analysis/index.json を更新 (DATA_DIR)
```

変更したら `pnpm check` を通してからコミットする。画面や同期に触ったら `pnpm build && pnpm e2e` も。CI は両方走る。

## テストの置き方

- `src/core/__tests__/` 純粋ロジック。棋譜は `fixtures.ts` の架空の短い棋譜か USI 手順を使う (合法手かどうかは parseKifu が検証する)。
- `src/db/*.test.ts`, `src/sync/*.test.ts`, `src/ui/*.test.tsx` はファイル先頭に `// @vitest-environment jsdom`。IndexedDB は fake-indexeddb、画面は Testing Library。
- `e2e/` は Playwright。`fixture.ts` の `syncWithMock` でデータリポジトリをモックする。
- 新しい判定ルール (戦法・囲い) を足すときは、それを満たす USI 手順をフィクスチャに足してテストする。

## データの互換性

- `GameRecord.parser` は `src/core/normalize.ts` の `PARSER_VERSION`。戦法判定などの出力を変えたら上げ、`pnpm reindex` でデータリポジトリを更新する。アプリは版が違うレコードを自動で取り直す。
- フィールドを足したら `normalizeSummary` / `normalizeGame` に既定値を足す。DB からの読み出しと同期の両方がここを通るので、古いデータが残っていても画面が壊れない。

## 方針

- バイブコーディングで進める。計画書や Issue を先に作らず、動くものを小さく足していく。
- 迷ったら「局面キーで対局を横断できること」を軸に考える。戦法分類・癖の抽出・分岐棋譜生成はすべてその上に乗せる。
