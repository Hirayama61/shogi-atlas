#!/bin/bash
# Claude Code のクラウドセッション開始時に依存関係を入れて、テスト・lint・ビルドが動く状態にする。
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || npm install -g pnpm@10
fi

pnpm install --frozen-lockfile
