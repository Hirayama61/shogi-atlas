# shogi-atlas

自分用の将棋棋譜アトラス。棋譜を集めて分類し、局面単位で横断検索する PWA。
GitHub Pages で公開し、スマホにインストールして使う。

## 絶対に守ること

- **棋譜データをこのリポジトリにコミットしない。** テスト用フィクスチャ (`src/core/__tests__/fixtures.ts`) の短い架空の棋譜だけが例外。
  棋譜の実データは非公開の `Hirayama61/shogi-atlas-data` に置く。この PWA は公開サイトなので、ビルド成果物に棋譜が混ざると公衆送信になる。
- **将棋ウォーズや第三者サイトを自動クロールするコードを書かない。** 取得は手動 (棋譜コピー → データリポジトリの Issue に貼る) が前提。
- トークンや秘密情報をコードに埋めない。
- **ライセンスに気をつける。** 将棋 AI やライブラリを採用・更新する前にライセンスを確認し、公開サイト (ビルド成果物) に何を含めてよいかを判断する。
  - やねうら王 (`@mizarjp/yaneuraou.k-p`) は GPL-3.0。今は `scripts/` (Node、非公開のデータリポジトリ向け) からしか使っていない。ブラウザ側に取り込む (ビルドに wasm を含める) ならサイト全体の配布条件が GPL の影響を受けるので、先に人に確認する。
  - tsshogi は MIT、Dexie は Apache-2.0、React / Workbox は MIT。依存を足したら `node_modules/<pkg>/package.json` の `license` を見て、GPL 系や不明なものは Issue に書いて人の判断を仰ぐ。
  - 棋譜サイトの利用規約も同じ扱い (自動取得しないのはそのため)。

## 構成

- `src/core/` 純粋な TypeScript。棋譜パース (`parse.ts`)、局面キー (`position.ts`)、戦型判定 (`opening.ts`)、将棋ウォーズ固有の解釈 (`wars.ts`)、将棋クエスト固有の解釈 (`quest.ts`: レート、時間切れ/接続切れ)、詰み判定 (`mate.ts`: 終局行が無い棋譜用)、共通スキーマ (`types.ts`)。DOM に依存しない。ブラウザと `scripts/` の両方から使う。
- `src/core/self.ts` 自分の複数 ID を「自分」1 人にまとめる。ID 一覧はデータリポジトリの `index.json` の `self` (`自分` ラベルの Issue のタイトル) にだけあり、アプリは DB の読み出し時、`scripts/profile.ts` は読み込み時に置き換える。
- `src/core/normalize.ts` 古いレコードを現在の型に揃える。`src/core/stats.ts` 対局者ごとの集計と分岐点。
- `src/db/` Dexie (IndexedDB)。`positions` の multiEntry インデックスで局面の完全一致検索をする。読み出し時に normalize を通す。
- `src/sync/` GitHub Contents API でデータリポジトリから `index.json` と `games/<id>.json` を取り込む。
- `src/ui/` React コンポーネント。ハッシュルーティング (`ui/router.ts`)。
- `src/changelog.ts` アプリ内の「更新情報」タブに出す一覧。**画面で見える機能を足したら、同じコミットで 1 件足す** (日付・見出し・1〜2 行の補足)。追加した機能だけを書き、修正・内部変更・運用の変更は書かない。core だけで画面が変わらない Issue (例: 集計関数の追加) は書かず、その UI を足す Issue で書く。新しいものを先頭に置く。未読判定は最新の日付で行う。
- `src/core/analysis.ts` エンジン解析の型と各手の評価 (損失・勝率の減少・疑問手/悪手/大悪手)。`src/core/profile.ts` 対局者の弱点プロファイル。`src/core/annotate.ts` 解析つき KIF。
- `scripts/engine.ts` やねうら王 (WebAssembly, `@mizarjp/yaneuraou.k-p`) の USI ラッパー。`scripts/analyze.ts` がデータリポジトリの未解析の対局を解析して `analysis/<id>.{json,kif}` を書き、`scripts/profile.ts` が `players/<name>/profile.{json,md}` と `analysis/index.json` を書く。
- `scripts/process-inbox.ts` データリポジトリの Issue 受信箱を処理して `games/` と `index.json` を書く。
- `scripts/pipeline.sh` (`pnpm pipeline`) 上の 3 つを pull → 受信箱 → 解析 → プロファイル → commit → push の順に 1 本で回す。Claude のルーティン「shogi-atlas 取り込み・解析 (2時間おき)」が、本体とデータリポジトリを接続した専用セッション「棋譜データ取り込みルーティン」で 2 時間おきに実行する。1 回の解析は 20 局・50 分まで (`MAX_GAMES`, `TIME_BUDGET`)。エンジン 1 本で 4 コアを使い切るので、並列化ではなく上限で調整する。
  データリポジトリの `process-inbox.yml` と `analyze.yml` は定期実行せず、手動実行の予備としてだけ残す。データリポジトリは private なので Actions の実行時間は無料枠を消費する。定期処理を Actions に戻さない。
  運用は「対局者ごとに Issue を 1 本、タイトル = 対局者名、コメントに棋譜を貼る」。処理済みは `inbox-state.json` で管理し、Issue は閉じない。
  棋譜の取り込み経路はこれだけ。アプリ側に貼り付け取り込みは置かない (Issue 指定やラベル付けが不便なため外した)。

棋譜ライブラリは `tsshogi` (KIF / KI2 / CSA / USI / JKF の読み書き、合法手判定)。

「対策レポート」は Claude のルーティン「将棋 対策レポート」(毎日 05:52 JST に新しいセッションで起動。claude.ai の Routines 画面から作ったもので、本体とデータリポジトリが接続される) が `/write-reports` (`.claude/skills/write-reports/SKILL.md`) の手順で書く。
入力はデータリポジトリの `players/<name>/profile.md` と `analysis/*.kif`、出力は `players/<name>/report.md`。前回のレポート以降に解析済みの対局が増えた人だけ書き直し、誰も増えていなければ何もしない。本体には何もコミットしない。
手順を変えるときはスキルを直す (ルーティンのプロンプトは「スキルを読んで実行せよ」だけ)。

## コマンド

```
pnpm dev          # 開発サーバー
pnpm check        # typecheck + lint + format:check + test
pnpm e2e          # Playwright (要 pnpm build)。GitHub API はモックし、同期から分岐点まで通す
pnpm test:coverage
pnpm build        # tsc + vite build (dist/)
pnpm inbox        # Issue 受信箱の処理 (GITHUB_TOKEN, DATA_DIR が必要)
pnpm reindex      # パーサー改良後に games/*.json を raw から解析し直す (DATA_DIR が必要)
pnpm analyze      # エンジン解析 (DATA_DIR, DEPTH, MAX_GAMES, ONLY, MOVE_TIME_LIMIT)
pnpm build-profiles  # 弱点プロファイルと analysis/index.json を更新 (DATA_DIR)
pnpm pipeline     # 上の inbox → analyze → build-profiles を回して commit と push まで (DATA_DIR, GITHUB_TOKEN。MAX_GAMES, TIME_BUDGET, SKIP_PUSH で調整)
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

## Issue 駆動の運用

- やりたいことは Issue にする。起案は `/create-issue` (テンプレート `.github/ISSUE_TEMPLATE/work-item.md`、承認してから作成)。
- 状態はラベル: `ready` (着手可) → `in-progress` (作業中) → 閉じて完了。人の判断待ちは `needs-input`。
- 先行する Issue がある場合は GitHub の Issue dependencies (blocked by) で表す (`gh api -X POST repos/Hirayama61/shogi-atlas/issues/<番号>/dependencies/blocked_by -F issue_id=<先行 Issue の id>`)。`blocked` ラベルは使わない (削除済み)。先行が閉じれば自動的に着手できる扱いになる。
- フェーズはマイルストーンで表す。「フェーズ 1: 機能改善」が今の対象で、「フェーズ 2: 学習と対局」(#8, #11 の構想) はフェーズ 1 が閉じてから分解して着手する。
- 領域ラベル `area:core` / `area:app` / `area:scripts` / `area:infra` / `area:data` で衝突を避ける。同じ領域の Issue を同時に 2 つ進めない。
- 着手は `/work-issue` の手順で。1 時間おき (毎時 7 分 UTC) のルーティン「shogi-atlas Issue 作業」が専用の作業セッション (本体とデータリポジトリの両方を接続済み) を起こし、同じ手順で `ready` を 1 件ずつ拾う。
- 会話の流れでそのまま着手してもよい。その場合も Issue を作り、`in-progress` を付けてから進める。
- データリポジトリ (shogi-atlas-data) に触る Issue は `area:data` を付ける。ワークフローや README の変更、パーサー変更に伴う `pnpm reindex` などが該当する。作業セッションには `/home/user/shogi-atlas-data` に clone がある。無いセッションでは `add_repo` (owner: Hirayama61, repo: shogi-atlas-data, access: push) で接続してから clone する。
- ルーティンは claude.ai の Routines 画面から作る。画面から作ったルーティンは起動ごとに新しいセッションを作り、本体とデータリポジトリが接続された状態で始まる (Issue 作業・対策レポートがこの形)。エージェントが `create_trigger` で作ったルーティンにはリポジトリが接続されないので、その場合だけ既存のセッションに向ける (persistent_session_id)。取り込み・解析は今も専用セッション向けで、画面から作り直したら付け替える。
- 自動化の見守りは毎朝のルーティン「shogi-atlas 見守り」が `/monitor-routines` の手順で行い、結果を Issue「運用ログ」(ラベル `ops`) にコメントする。人はそこだけ見ればよい。
- 棋譜の取り込みと解析はルーティン「shogi-atlas 取り込み・解析 (2時間おき)」が専用セッションで `pnpm pipeline` を回す。すぐ取り込みたいときは claude.ai の Routines からそのルーティンを手動実行する。

## 方針

- バイブコーディングで進める。計画書を先に作らず、動くものを小さく足していく。Issue は「次に何をやるか」の受け渡しのためで、設計書ではない。
- 迷ったら「局面キーで対局を横断できること」を軸に考える。戦法分類・癖の抽出・分岐棋譜生成はすべてその上に乗せる。
