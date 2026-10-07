#!/usr/bin/env bash
# 前回の pipeline が途中で殺された (外側の timeout など) ときの残骸を片付け、git pull できる状態に戻す。
# scripts/pipeline.sh が最初に呼ぶ。引数はデータリポジトリの clone。
#
# - rebase の途中なら中止する。
# - analysis/<id>.{json,kif} は 1 局ずつ一時ファイルから置き換えて書くので、残っていれば完全な解析結果。コミットして残す。
# - それ以外 (受信箱の games/ や index.json、inbox-state.json、プロファイル、analysis/index.json) は捨てる。
#   受信箱は inbox-state.json が進んでいなければ同じコメントを取り込み直し、プロファイルは毎回作り直すので失われない。
set -euo pipefail
dir="${1:?データリポジトリのパスが必要です}"
data() { git -C "$dir" "$@"; }

gitdir="$(data rev-parse --absolute-git-dir)"
for d in rebase-merge rebase-apply; do
  if [ -d "$gitdir/$d" ]; then
    echo "前回の rebase を中止します"
    data rebase --abort
    break
  fi
done
data checkout -q main

if [ -z "$(data status --porcelain)" ]; then
  exit 0
fi
echo "前回の実行の残骸があります"
find "$dir/analysis" -name '*.tmp' -delete 2>/dev/null || true
data add -A -- analysis ':!analysis/index.json' 2>/dev/null || true
if ! data diff --cached --quiet; then
  data -c user.name="${GIT_AUTHOR_NAME:-$(data config user.name || echo shogi-atlas pipeline)}" \
       -c user.email="${GIT_AUTHOR_EMAIL:-$(data config user.email || echo pipeline@shogi-atlas.invalid)}" \
       commit -q -m "analysis: 前回中断した実行の解析結果"
  echo "commit: 前回中断した実行の解析結果"
fi
data reset -q --hard HEAD
data clean -q -fd
