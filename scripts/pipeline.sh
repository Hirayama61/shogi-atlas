#!/usr/bin/env bash
# データリポジトリの受信箱処理 → エンジン解析 → 弱点プロファイル → commit → push を 1 本で回す。
# Claude のルーティン「shogi-atlas 取り込み・解析 (2時間おき)」が専用セッションで呼ぶ。
# GitHub Actions ではなくクラウドセッションで動かすのは、private リポジトリの Actions の無料枠 (CPU 時間) を使わないため。
#
# 環境変数:
#   DATA_DIR      データリポジトリの clone (必須)
#   GITHUB_TOKEN  Issue の読み書きができるトークン (必須。受信箱処理が使う)
#   MAX_GAMES     1 回で解析する最大局数 (既定: 10)
#   TIME_BUDGET   解析の目安時間 (秒)。超えたら新しい対局を始めない (既定: 1500 = 25 分)
#   DEPTH, ONLY   scripts/analyze.ts にそのまま渡す
#   SKIP_PUSH     1 なら commit まで行い push しない (動作確認用)
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATA_DIR:?DATA_DIR が必要です}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN が必要です}"
export DATA_DIR
export MAX_GAMES="${MAX_GAMES:-10}"
export TIME_BUDGET="${TIME_BUDGET:-1500}"

data() { git -C "$DATA_DIR" "$@"; }

commit_if_changed() {
  data add -A
  if data diff --cached --quiet; then
    echo "変更なし ($1)"
    return
  fi
  data -c user.name="${GIT_AUTHOR_NAME:-$(data config user.name || echo shogi-atlas pipeline)}" \
       -c user.email="${GIT_AUTHOR_EMAIL:-$(data config user.email || echo pipeline@shogi-atlas.invalid)}" \
       commit -q -m "$1"
  echo "commit: $1"
}

echo "== 最新化"
data checkout -q main
data pull -q --rebase origin main

echo "== 受信箱"
# Node の fetch は HTTPS_PROXY を読まない。クラウドセッションでは GitHub API の認証をプロキシが付けるので経由させる (Actions では無害)
NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1 pnpm --silent inbox
commit_if_changed "inbox: 棋譜を取り込み"

echo "== 解析 (最大 ${MAX_GAMES} 局, 目安 ${TIME_BUDGET} 秒)"
pnpm --silent analyze

echo "== プロファイル"
pnpm --silent build-profiles
commit_if_changed "analysis: エンジン解析とプロファイルを更新"

if [ "$(data rev-list --count origin/main..main)" -eq 0 ]; then
  echo "== push するものはありません"
  exit 0
fi
if [ "${SKIP_PUSH:-0}" = "1" ]; then
  echo "== SKIP_PUSH=1 なので push しません"
  exit 0
fi
echo "== push"
data pull -q --rebase origin main
data push -q origin main
echo "完了: $(data log --oneline origin/main -1)"
