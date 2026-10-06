---
name: monitor-routines
description: shogi-atlas の自動化 (Issue 作業の作業セッション、棋譜の取り込み・解析、対策レポート、データリポジトリの GitHub Actions) を点検し、止まっているものを直し、結果を「運用ログ」Issue に記録する。毎朝のルーティンが使う。
---

# monitor-routines

人はルーティンのセッションを見ない前提。異常の検知と一次対応までをここで済ませ、人の判断が要ることだけを運用ログで知らせる。
GitHub の操作は `gh api` (REST)。セッションとルーティンの操作は `mcp__claude-code-remote__*` ツール (list_triggers / get_session / list_events / update_trigger / fire_trigger / create_session / create_trigger / delete_trigger)。

## 1. 点検

### a. ルーティンと作業セッション

`list_triggers` で次の 3 本を確認する。

- 「shogi-atlas Issue 作業 (…おき)」(名前の括弧内は変わりうる。1 時間おき、毎時 7 分 UTC)
- 「shogi-atlas 取り込み・解析 (2時間おき)」(専用セッション「棋譜データ取り込みルーティン」で `pnpm pipeline` を回す)
- 「将棋 対策レポート」(画面から作成。起動ごとに新しいセッションで本体を pull し `/write-reports` の手順で、前回以降に解析が増えた人だけ書き直す。「更新なし」で終わる日が多いのは正常)

それぞれについて:

- `enabled` が true、`last_run.status` が SUCCEEDED か。FAILED なら異常。
- `persistent_session_id` の `get_session` で `session_status` と `post_turn_summary`、`external_metadata.context_usage.used_tokens` を見る。
  - `status_bucket` が FAILED、または `list_events` (kinds: result) の最新が `is_error` なら異常。
  - `used_tokens` が 700,000 を超えていたら「作り直し時期」。
- 作業セッションの直近の結果 (`list_events` kinds: result, 最新 1 件の `result` 文) を読み、「push 権限が無い」「候補なし」「needs-input」のどれで終わったかを把握する。
- 取り込み・解析セッションの直近の結果を読み、「完了」「変更なし」「失敗 (理由)」のどれで終わったかを把握する。あわせてデータリポジトリの最新コミットを見る:

  ```sh
  D=repos/Hirayama61/shogi-atlas-data
  gh api "$D/commits?per_page=5" --jq '.[] | "\(.commit.committer.date) \(.commit.message | split("\n")[0])"'
  ```

  直近 24 時間に `inbox:` か `analysis:` のコミットが 1 つも無く、セッションの結果が「変更なし」でもないなら「取り込みが止まっている」。

### b. GitHub Actions (データリポジトリ)

```sh
D=repos/Hirayama61/shogi-atlas-data
gh api "$D/actions/runs?per_page=20" --jq '.workflow_runs[] | "\(.created_at) \(.name) [\(.event)] \(.status) \(.conclusion)"'
```

- `Process kifu inbox` と `Engine analysis` は定期実行しない (取り込みと解析はルーティンが行う)。`schedule` の実行が現れていたらワークフローに `schedule` が戻っているので異常 (private リポジトリの無料枠を消費する)。
- 手動実行 (`workflow_dispatch`) の conclusion が failure のものがあれば異常。`gh api "$D/actions/runs/<id>/jobs"` で失敗ステップを見る (ログ本文は取れないことがある)。

### c. 本体の CI

```sh
R=repos/Hirayama61/shogi-atlas
gh api "$R/actions/runs?branch=main&per_page=5" --jq '.workflow_runs[] | "\(.created_at) \(.name) \(.status) \(.conclusion) \(.head_sha[0:7])"'
```

main の最新コミットで CI か Deploy が failure なら異常。

### d. Issue の滞留

```sh
gh api "$R/issues?state=open&labels=in-progress" --jq '.[] | "#\(.number) \(.title) updated \(.updated_at)"'
gh api "$R/issues?state=open&labels=needs-input" --jq '.[] | "#\(.number) \(.title)"'
gh api "$R/issues?state=open&labels=ready" --jq '.[] | "#\(.number) \(.title)"'
```

- `in-progress` のまま 6 時間以上更新が無いものは放置。コメントを残して `in-progress` を外し、`ready` に戻す。
- `needs-input` は人の判断待ち。運用ログに列挙する (催促しない)。
- 先行 Issue (dependencies の blocked_by) がすべて閉じているのに `ready` が付いていない Issue は、`ready` を付けてよい (構想 Issue やフェーズ 2 のものは除く)。

## 2. 一次対応

- **取り込みが止まっている**: 取り込み・解析のルーティンを `fire_trigger` で 1 回起動する。それでもコミットが増えなければ、予備として `gh api -X POST "$D/actions/workflows/process-inbox.yml/dispatches" -f ref=main` で受信箱だけ手動起動し (`analyze.yml` は長く走って無料枠を使うので起動しない)、運用ログに「要確認」として書く。
- **ワークフローに `schedule` が戻っている**: 外す Issue (`area:data`, `ready`) を起案する。
- **Actions が失敗**: 原因がデータ (壊れた棋譜など) なら該当 Issue のコメントに書き、コードなら `ready` の Issue を起案する。同じ原因で 2 回目なら Issue の冒頭にその旨を書く。
- **ルーティンの last_run が FAILED / セッションが FAILED**: `fire_trigger` で 1 回再実行する。再実行も失敗したら運用ログに「要確認」として書く。
- **作業セッションが「push 権限が無い」で終わっていた**: セッションにリポジトリが接続されていない。`create_session` (source_url: https://github.com/Hirayama61/shogi-atlas, revision main, outcome_branch main, permission_mode auto) で作業セッションを作り直し、初回プロンプトで `add_repo` によるデータリポジトリ接続を指示し、`delete_trigger` → `create_trigger` (persistent_session_id を新セッションに) で付け替える。対策レポートの作業セッションも同様 (source_url はデータリポジトリ)。取り込み・解析のセッションも同様 (source_url は本体。初回プロンプトで `add_repo` によるデータリポジトリ接続と `/home/user/shogi-atlas-data` への clone を指示する)。
- **used_tokens が 700,000 超**: 上と同じ手順で作り直して付け替える (壊れていなくても)。
- **本体 CI が失敗**: `ready` の Issue を起案する (`area:infra` か失敗箇所の領域)。直前のコミットが分かるならそのコミット ID を本文に書く。
- **Issue の放置**: 上記のとおり `ready` に戻す。

対応は 1 回の実行で済む範囲にとどめる。コードの修正はしない (Issue にして作業セッションに任せる)。

## 3. 運用ログ

本体リポジトリの Issue「運用ログ」(ラベル `ops`) に 1 コメントを投稿する。

```sh
N=$(gh api "$R/issues?state=open&labels=ops" --jq '.[0].number')
gh api -X POST "$R/issues/$N/comments" -F body=@<ファイル>
```

書式 (10 行以内、異常が無ければ 3 行):

```
## YYYY-MM-DD 点検
- 作業セッション: 正常 / 異常 (直近: #N 完了 / 候補なし / needs-input)
- 取り込み・解析: 正常 / 異常 (直近のコミット M/D HH:MM、解析済み N 局)
- 対策レポート: 正常 / 次回 M/D
- Actions: 手動実行の失敗なし / 失敗あり
- 対応したこと: ... (無ければ「なし」)
- 要確認: ... (無ければ書かない)
```

運用ログの Issue が無ければ作る (タイトル「運用ログ」、ラベル `ops`、本文に「毎朝の点検結果を監視ルーティンがコメントする」)。

## 4. 報告

最後に運用ログに書いた内容をそのまま報告して終える。
