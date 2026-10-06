---
name: work-issue
description: ready な Issue を 1 件選んで (または指定された Issue を) 着手し、検証を通して main に push し、Issue を閉じる。ルーティンと対話セッションの両方がこの手順で動く。
argument-hint: "[Issue 番号 (省略時は自動で選ぶ)]"
---

# work-issue

1 回の実行で扱う Issue は 1 件。終わったら次を拾わずに報告して終える (ルーティンは次の起動で次を拾う)。

## 1. 最新化

```sh
git -C /home/user/shogi-atlas checkout main && git -C /home/user/shogi-atlas pull --rebase origin main
pnpm --dir /home/user/shogi-atlas install --frozen-lockfile
```

GitHub の操作は `gh api` (REST) で行う。`gh issue ...` サブコマンドは GraphQL を使うためこの環境では失敗する。

## 2. Issue を選ぶ

番号が指定されていればそれを使う。指定が無ければ:

```sh
R=repos/Hirayama61/shogi-atlas
gh api "$R/issues?state=open&labels=ready&per_page=100" --jq '.[] | "#\(.number) \(.title) [\([.labels[].name]|join(","))] \(.created_at)"'
gh api "$R/issues?state=open&labels=in-progress&per_page=100" --jq '.[] | "#\(.number) \(.title) [\([.labels[].name]|join(","))] \(.updated_at)"'
```

- `in-progress` の Issue が持つ `area:*` ラベルと重なる `area:*` を持つ Issue は選ばない (同じ領域を同時に触らない)。
- `needs-input` は選ばない。
- 先行 Issue が open のものは選ばない: `gh api "$R/issues/$N/dependencies/blocked_by" --jq '[.[] | select(.state == "open")] | length'` が 0 でなければ飛ばす。
- マイルストーンが「フェーズ 2」以降のものは、フェーズ 1 のマイルストーンが閉じるまで選ばない (構想 Issue は `ready` にならないので通常は候補に出ない)。
- `in-progress` のまま 6 時間以上更新が無い Issue は放置されたとみなし、その旨をコメントして `in-progress` を外してよい (選ぶのは次回)。
- 残った候補から、古いものを優先して 1 件選ぶ。候補が無ければ「着手できる Issue はありません」と報告して終える。

## 3. 着手の宣言

```sh
N=<番号>
gh api -X POST "$R/issues/$N/labels" -f 'labels[]=in-progress' >/dev/null
gh api -X DELETE "$R/issues/$N/labels/ready" >/dev/null
gh api -X POST "$R/issues/$N/comments" -f body="着手します (セッション: <自分のセッション名か ID>, $(date -u +%Y-%m-%dT%H:%MZ))" >/dev/null
```

## 4. 実装

- Issue 本文の「達成したい状態」「スコープ」「制約」「完了条件」に従う。本文に無いことはやらない。
- CLAUDE.md の約束事を守る (棋譜データを本体に入れない、クロールしない、テストを足す、`PARSER_VERSION` のルール)。
- 画面で見える機能を足したら `src/changelog.ts` の先頭に 1 件足す (日付・見出し・1〜2 行の補足)。core だけの Issue では書かない。
- 本文の前提が間違っている、判断が要る、完了条件を満たせないと分かったら、理由をコメントして `needs-input` を付け (`gh api -X POST "$R/issues/$N/labels" -f 'labels[]=needs-input'`)、`in-progress` を外し (`gh api -X DELETE "$R/issues/$N/labels/in-progress"`)、変更は push せずに終える。

## 5. 検証

```sh
pnpm --dir /home/user/shogi-atlas check
pnpm --dir /home/user/shogi-atlas build && pnpm --dir /home/user/shogi-atlas e2e   # 画面・同期・ルーティングに触ったとき
```

通らなければ直す。通るまで push しない。

## 5b. データリポジトリに触る Issue (`area:data`)

- clone は `/home/user/shogi-atlas-data`。無ければ `add_repo` (owner: Hirayama61, repo: shogi-atlas-data, access: push) で接続してから clone する。
- 変更前に `git -C /home/user/shogi-atlas-data pull --rebase origin main`。
- パーサーを変えて `PARSER_VERSION` を上げたら `DATA_DIR=/home/user/shogi-atlas-data pnpm --dir /home/user/shogi-atlas reindex` を実行し、データリポジトリ側もコミットして push する。
- 棋譜ファイル (`games/`, `analysis/`) を手で編集しない。スクリプト経由で更新する。

## 6. push と完了

- コミットメッセージの本文に `Closes #<番号>` を入れる (main への push で Issue が閉じる)。
- `git pull --rebase origin main` してから `git push origin main`。衝突したら解消して検証をやり直す。
- Issue に 5 行以内で「何をどう変えたか」「検証したこと」「残したこと」をコメントする (`gh api -X POST "$R/issues/$N/comments" -f body=...`)。
- `in-progress` を外す (`gh api -X DELETE "$R/issues/$N/labels/in-progress"`)。push で閉じなかった場合は `gh api -X PATCH "$R/issues/$N" -f state=closed -f state_reason=completed`。

## 7. 報告

最後に、扱った Issue 番号、結果 (完了 / needs-input / 候補なし)、コミット ID を 1〜3 行で報告する。
