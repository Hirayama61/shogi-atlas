---
name: write-reports
description: 登録した対局相手ごとに「その人に勝つための対策レポート」(データリポジトリの players/<名前>/report.md) を書く。前回以降に対局か解析が増えた人だけ書き直す。毎日のルーティン「将棋 対策レポート (毎日)」が使う。
disable-model-invocation: true
---

# write-reports

あなたは将棋の研究パートナー。登録した対局相手ごとに「その人に勝つための対策レポート」を書く。
入力はエンジン解析 (弱点プロファイルと解析つき棋譜)、出力はデータリポジトリの `players/<名前>/report.md`。本体リポジトリには何もコミットしない。

## 1. 準備

```sh
git -C /home/user/shogi-atlas checkout -q main && git -C /home/user/shogi-atlas pull -q --rebase origin main
test -d /home/user/shogi-atlas-data || git clone -q https://github.com/Hirayama61/shogi-atlas-data /home/user/shogi-atlas-data
git -C /home/user/shogi-atlas-data checkout -q main && git -C /home/user/shogi-atlas-data pull -q --rebase origin main
```

- 本体の `CLAUDE.md` の約束事を守る。棋譜データを本体にコミットしない、将棋ウォーズや第三者サイトをクロールしない。
- GitHub の操作は `gh api` (REST) で行う。`gh issue ...` は GraphQL を使うためこの環境では失敗する。
- データリポジトリの `README.md` に構成が書いてある。

## 2. 更新判定 (誰のレポートを書くか)

対象は `players/` 配下にプロファイル (`profile.md`) がある人全員。次の順に見る。

1. `players/<名前>/profile.md` の「解析済み: N 局」が 0 なら飛ばす。
2. `players/<名前>/report.md` が無ければ新規に書く。
3. あれば、前回のレポートの冒頭 (作成日、解析済み局数、対象期間) と今のプロファイルを比べる。解析済み局数が増えていれば書き直す。局数が同じでも `index.json` でその人の対局 (名前が `black` / `white` のどちらか) が前回の作成日より後に増えていれば (`importedAt`)、解析待ちの対局があるので「解析が揃ってから」として今回は飛ばしてよい。
4. 誰も該当しなければ、何もせず (commit も push もせず)「更新なし」と 1 行報告して終える。

## 3. 入力

- `players/<名前>/profile.md` と `profile.json`: 段階別の精度、戦法別の精度、有利を活かす率、粘り、相手の大悪手を咎めた率、先に大悪手を指す率、痛かった手。
- `analysis/<id>.kif`: 評価値と最善手をコメントに入れた棋譜。`games/<id>.json` に対局のメタ情報 (対局者、戦型、囲い、結果、持ち時間)。
- `players/<名前>/report.md`: 前回のレポート。書き直すときは前回の内容を引き継ぎ、増えた対局で裏付けが変わった箇所を直す (丸ごと書き直してもよいが、前回と矛盾する断定を残さない)。
- その人の対局は `index.json` で名前が `black` か `white` に入っているもの。解析があるのは `analysis/index.json` に id があるもの。

## 4. 出力

`players/<名前>/report.md` を書く (上書き)。冒頭に `# <名前> 対策レポート` と、作成日・解析済み局数・対象期間・主な持ち時間と相手の棋力を 1〜2 行。構成:

1. **一言でいうとどういう相手か**: 戦法の傾向、強みと弱み。事実 (数字) と推測を分ける。
2. **こちらが採るべき作戦**: 「こちらが先手 (相手が後手)」「こちらが後手 (相手が先手)」に分け、相手の苦手な戦型へ誘導する序盤の方針を書く。相手の採用戦法ごとに「こう来たらこう」を具体的な手順で書く。実績のある対局は id と相手名を添える。データが無い組み合わせは「データなし」と書く。
3. **狙いどころ**: 崩れやすい段階 (序盤/中盤/終盤) と崩れ方のパターン。「痛かった手」として局面を 3〜5 個引用し、対局 id・手数・指した手・最善手・評価値の変化・なぜ悪かったかを将棋の言葉で説明する。局面は sfen を添える。
4. **気をつけること**: 相手の得意な形、こちらが避けるべき展開、持ち時間の注意。
5. **次に集めたい情報**: 判断に足りないデータ (後手番の対局が少ない、相居飛車が無い、など)。
6. 末尾に「根拠: 解析済み N 局、エンジン やねうら王 NNUE K-P (WebAssembly) 深さ D、作成日 YYYY-MM-DD」と、軽量エンジンの浅い読みなので細かい評価値 (±200 程度) や詰みの有無は鵜呑みにしないという注意を 1 行。

文体は簡潔な日本語で箇条書き中心。局数が少ないときは断定せず「傾向」と書く。既存のレポート (`players/zudoon/report.md`) が書き方の見本。

## 5. 仕上げ

1. `git -C /home/user/shogi-atlas-data add players && git -C /home/user/shogi-atlas-data commit -m "report: 対策レポートを更新 (<名前>, ...)"`。続けて `git pull --rebase origin main && git push origin main`。衝突したら `players/` 以外は相手側を採る。
2. その対局者の Issue (データリポジトリの open な Issue でタイトルが対局者名のもの) があれば、`gh api -X POST repos/Hirayama61/shogi-atlas-data/issues/<番号>/comments` で「一言」と「採るべき作戦」の要約を 10 行以内でコメントする。末尾に `(対策レポート: players/<名前>/report.md)` と書く。Issue が無ければ投稿しない。
3. 最後に、誰のレポートを更新したか (または「更新なし」) を 1 行ずつ報告する。

## 禁止

- 本体リポジトリ (shogi-atlas) に何もコミットしない。
- 棋譜サイトや第三者サイトをクロールしない。レポートの材料はデータリポジトリの中身だけ。
- `games/`、`analysis/`、`index.json`、`inbox-state.json` を手で編集しない。
