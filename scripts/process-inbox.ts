/**
 * shogi-atlas-data の Issue 受信箱を処理して games/<id>.json と index.json を更新する。
 *
 * 環境変数:
 *   GITHUB_TOKEN  Issue の読み書きができるトークン (Actions の GITHUB_TOKEN で可)
 *   DATA_REPO     "owner/repo" (既定: Hirayama61/shogi-atlas-data)
 *   DATA_DIR      データリポジトリのチェックアウト先 (既定: ../shogi-atlas-data)
 *   INBOX_LABEL   対象 Issue のラベル (既定: kifu)
 *   DRY_RUN       "1" でファイルも Issue も変更しない
 *
 * git のコミットと push は呼び出し側 (ワークフロー) が行う。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseKifu } from "../src/core/parse";
import { toSummary, type GameIndex, type GameRecord } from "../src/core/types";
import { GAME_SHAPE_LABEL } from "../src/core/opening";
import { parseIssueBody } from "./inbox";

const token = process.env.GITHUB_TOKEN;
const dataRepo = process.env.DATA_REPO ?? "Hirayama61/shogi-atlas-data";
const dataDir = path.resolve(process.env.DATA_DIR ?? "../shogi-atlas-data");
const inboxLabel = process.env.INBOX_LABEL ?? "kifu";
const dryRun = process.env.DRY_RUN === "1";

if (!token) {
  console.error("GITHUB_TOKEN が必要です");
  process.exit(1);
}

interface Issue {
  number: number;
  title: string;
  body: string | null;
  labels: Array<{ name: string }>;
  pull_request?: unknown;
}

async function gh<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.github.com${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

async function comment(issue: number, text: string): Promise<void> {
  if (dryRun) {
    console.log(`[dry-run] comment #${issue}:\n${text}`);
    return;
  }
  await gh("POST", `/repos/${dataRepo}/issues/${issue}/comments`, { body: text });
}

async function close(issue: number, labels: string[]): Promise<void> {
  if (dryRun) {
    console.log(`[dry-run] close #${issue} labels=${labels.join(",")}`);
    return;
  }
  await gh("PATCH", `/repos/${dataRepo}/issues/${issue}`, {
    state: "closed",
    state_reason: "completed",
    labels,
  });
}

async function addLabel(issue: number, label: string): Promise<void> {
  if (dryRun) {
    console.log(`[dry-run] label #${issue} +${label}`);
    return;
  }
  await gh("POST", `/repos/${dataRepo}/issues/${issue}/labels`, { labels: [label] });
}

async function loadIndex(): Promise<GameIndex> {
  const file = path.join(dataDir, "index.json");
  if (!existsSync(file)) return { schema: 1, updatedAt: new Date().toISOString(), games: [] };
  return JSON.parse(await readFile(file, "utf8")) as GameIndex;
}

async function saveGame(game: GameRecord): Promise<void> {
  const dir = path.join(dataDir, "games");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${game.id}.json`), JSON.stringify(game, null, 2) + "\n");
}

async function main(): Promise<void> {
  const issues = await gh<Issue[]>(
    "GET",
    `/repos/${dataRepo}/issues?state=open&labels=${encodeURIComponent(inboxLabel)}&per_page=100`,
  );
  const targets = issues.filter(
    (i) => !i.pull_request && !i.labels.some((l) => l.name === "needs-fix"),
  );
  console.log(`対象 Issue: ${targets.length} 件`);
  if (targets.length === 0) return;

  const index = await loadIndex();
  const known = new Map(index.games.map((g) => [g.id, g] as const));
  let changed = false;

  for (const issue of targets) {
    const entry = parseIssueBody(
      issue.body ?? "",
      issue.labels.map((l) => l.name),
    );
    if (entry.kifuBlocks.length === 0) {
      await comment(
        issue.number,
        "棋譜が見つかりませんでした。本文に KIF を貼り直してください。\n\n(自動処理)",
      );
      await addLabel(issue.number, "needs-fix");
      continue;
    }

    const lines: string[] = [];
    let failed = false;
    for (const [i, block] of entry.kifuBlocks.entries()) {
      try {
        const game = await parseKifu(block, {
          source: entry.url
            ? { kind: "url", url: entry.url, issue: issue.number }
            : { kind: "issue", issue: issue.number },
          tags: entry.tags,
          memo: entry.memo,
        });
        if (known.has(game.id)) {
          lines.push(`- ${i + 1} 件目: 既に登録済み (\`${game.id}\`)`);
          continue;
        }
        if (!dryRun) await saveGame(game);
        const summary = toSummary(game);
        known.set(game.id, summary);
        index.games.push(summary);
        changed = true;
        lines.push(
          `- ${i + 1} 件目: ☗${game.black} vs ☖${game.white} (${game.startedAt ?? "日付不明"}) ${GAME_SHAPE_LABEL[game.opening.shape]} ${game.length}手 → \`${game.id}\``,
        );
      } catch (e) {
        failed = true;
        lines.push(`- ${i + 1} 件目: 読み込み失敗: ${(e as Error).message}`);
      }
    }

    const header = failed
      ? "一部の棋譜を読み込めませんでした。本文を直すと次回に再処理します。"
      : "取り込みました。";
    await comment(issue.number, `${header}\n\n${lines.join("\n")}\n\n(自動処理)`);
    if (failed) {
      await addLabel(issue.number, "needs-fix");
    } else {
      await close(
        issue.number,
        issue.labels.map((l) => l.name),
      );
    }
  }

  if (changed && !dryRun) {
    index.games.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
    index.updatedAt = new Date().toISOString();
    await writeFile(path.join(dataDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
    console.log(`index.json を更新: ${index.games.length} 局`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
