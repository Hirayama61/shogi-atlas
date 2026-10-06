---
name: create-issue
description: 依頼や作業中の摩擦を、解く価値と着手可能性を検証した GitHub Issue に変換して起案する。起案した Issue はルーティンか別のセッションが拾って実装する。
argument-hint: "[依頼や摩擦の要約]"
disable-model-invocation: true
---

# create-issue

依頼をそのままチケット化しない。解く価値のある Issue へ変換し、読み手 (人間・AI エージェント) が本文だけで着手できる形にしてから GitHub へ残す。

一度に扱う Issue は 1 件。候補が複数あっても一括生成しない (複数あるなら 1 件ずつこの手順を繰り返す)。
現在の作業スコープ内で安全にその場で解消できる課題は、Issue にせず修正を提案する。

DISCOVER → FRAME → GRILL → DRAFT → CREATE の順に進める。

## DISCOVER: 自分で調べる

README・CLAUDE.md・関連コード・既存 Issue (`gh api "repos/Hirayama61/shogi-atlas/issues?state=all&per_page=100"`) を読み、事実を集める。GitHub の操作は `gh api` (REST) で行う (`gh issue ...` は GraphQL を使うためこの環境では失敗する)。
コードや設定から分かることをユーザーに聞かない。似た Issue が既にあれば、新しく作らずそちらを案内する。

## FRAME: 解くべき問題を定義する

依頼された作業ではなく、解くべき問題を一文の仮説として立てる。
一文にならないなら複数の問題が混ざっている。分割して 1 件ずつ扱う。

## GRILL: What を変える曖昧さだけ聞く

質問は 1 問ずつ。選択肢と推奨を添える。
聞いてよいのは、回答によって Issue の目的・スコープ・完了条件が変わる場合だけ。
実装方法 (How) しか変わらない質問はしない。

## DRAFT: テンプレートへ圧縮する

`.github/ISSUE_TEMPLATE/work-item.md` を読み、その構成を本文の正とする。
下書きが Quality Gate をすべて通ることを確認する。

1. Impact: 解決すると何が変わるか。読み手の行動が変わらないなら起案しない
2. Problem: 解こうとしている問題は本当にそれか
3. Hypothesis: 原因や改善方法の見立てはあるか。単純作業では省略できる
4. Answerability: この Issue 単体で完了判定できるか
5. Scope: 独立した目的が 2 つ以上混ざっていないか
6. Evidence: コードで確認できる事実は調査済みか
7. Freedom: 実装方法を必要以上に固定していないか。制約と完了条件で What を固め、How は空ける

ラベルを決める。状態は `ready` (すぐ着手できる) か `needs-input` (人の判断が要る)。
領域は `area:core` / `area:app` / `area:scripts` / `area:infra` / `area:data` から該当するものすべて (ルーティンはこの領域が重なる Issue を同時に拾わない)。
データリポジトリ側の変更を含むなら `area:data` を付け、本文の制約に何を変えるかを明記する。

## CREATE: 承認を得てから作る

タイトルと本文の最終案を提示し、承認を得てから作成する。承認前に作成しない。

```sh
gh api -X POST repos/Hirayama61/shogi-atlas/issues -f title="..." -F body=@<本文ファイル> -f 'labels[]=ready' -f 'labels[]=area:app'
```

ユーザーが「そのまま着手して」と言ったら、作成後に `/work-issue <番号>` の手順で続ける。

着手をブロックする Issue があれば、本文の「参考情報」に「#<番号> が先」と書き、GitHub の Issue dependencies で表す (`blocked` ラベルは使わない):

```sh
ID=$(gh api repos/Hirayama61/shogi-atlas/issues/<先行の番号> --jq .id)
gh api -X POST repos/Hirayama61/shogi-atlas/issues/<新しい番号>/dependencies/blocked_by -F issue_id=$ID
```

マイルストーンも付ける (`-F milestone=<番号>`。今は 1 = フェーズ 1: 機能改善、2 = フェーズ 2: 学習と対局)。
