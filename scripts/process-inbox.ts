/**
 * shogi-atlas-data の Issue 受信箱を処理して games/<id>.json と index.json を更新する。
 *
 * 運用:
 *   - 対局者ごとに Issue を 1 本立てる。タイトルが対局者名になり、自動でタグに入る。
 *   - 本文とコメントに棋譜を貼る。取り込めたものには 🚀、読めなかったものには 😕 のリアクションを付け、
 *     読めなかった場合だけ理由をコメントで返す。本文やコメントを編集すると再処理される。
 *   - Issue は閉じない。その人との対局が終わったら手で閉じる。閉じた Issue は処理対象外。
 *   - `not-kifu` ラベルを付けた Issue は無視する。
 *
 * 環境変数:
 *   GITHUB_TOKEN  Issue の読み書きができるトークン (Actions の GITHUB_TOKEN で可)
 *   DATA_REPO     "owner/repo" (既定: Hirayama61/shogi-atlas-data)
 *   DATA_DIR      データリポジトリのチェックアウト先 (既定: ../shogi-atlas-data)
 *   DRY_RUN       "1" でファイルも Issue も変更しない
 *
 * git のコミットと push は呼び出し側 (ワークフロー) が行う。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseKifu } from "../src/core/parse";
import { toSummary, type GameIndex, type GameRecord, type GameSource } from "../src/core/types";
import { GAME_SHAPE_LABEL } from "../src/core/opening";
import { parseIssueBody, playerFromTitle } from "./inbox";

const token = process.env.GITHUB_TOKEN;
const dataRepo = process.env.DATA_REPO ?? "Hirayama61/shogi-atlas-data";
const dataDir = path.resolve(process.env.DATA_DIR ?? "../shogi-atlas-data");
const dryRun = process.env.DRY_RUN === "1";
const SKIP_LABEL = "not-kifu";
/** これより短いものは棋譜の断片とみなして取り込まない */
const MIN_MOVES = 5;

if (!token) {
  console.error("GITHUB_TOKEN が必要です");
  process.exit(1);
}

interface Issue {
  number: number;
  title: string;
  body: string | null;
  updated_at: string;
  labels: Array<{ name: string }>;
  pull_request?: unknown;
}

interface Comment {
  id: number;
  body: string | null;
  updated_at: string;
  user: { type: string; login: string };
}

/** 処理済みの本文・コメントと、そのときの updated_at。変わっていたら再処理する。 */
interface InboxState {
  schema: 1;
  issues: Record<string, string>;
  comments: Record<string, string>;
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

async function listAll<T>(url: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const sep = url.includes("?") ? "&" : "?";
    const items = await gh<T[]>("GET", `${url}${sep}per_page=100&page=${page}`);
    out.push(...items);
    if (items.length < 100) return out;
  }
}

async function comment(issue: number, text: string): Promise<void> {
  if (dryRun) {
    console.log(`[dry-run] comment #${issue}:\n${text}`);
    return;
  }
  await gh("POST", `/repos/${dataRepo}/issues/${issue}/comments`, { body: text });
}

async function react(
  target: { issue: number } | { comment: number },
  content: "rocket" | "confused",
) {
  if (dryRun) {
    console.log(`[dry-run] react ${JSON.stringify(target)} ${content}`);
    return;
  }
  const url =
    "comment" in target
      ? `/repos/${dataRepo}/issues/comments/${target.comment}/reactions`
      : `/repos/${dataRepo}/issues/${target.issue}/reactions`;
  await gh("POST", url, { content });
}

async function loadJson<T>(file: string, fallback: T): Promise<T> {
  if (!existsSync(file)) return fallback;
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function saveJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + "\n");
}

interface Context {
  index: GameIndex;
  known: Map<string, GameRecord["id"]>;
  changed: boolean;
}

/** 本文またはコメント 1 件分を処理し、結果の説明行を返す。 */
async function processText(
  ctx: Context,
  text: string,
  issue: Issue,
  source: GameSource,
): Promise<{ lines: string[]; imported: number; failed: boolean; empty: boolean }> {
  const labels = issue.labels.map((l) => l.name);
  const entry = parseIssueBody(text, labels);
  const player = playerFromTitle(issue.title);
  const tags = Array.from(new Set([...(player ? [player] : []), ...entry.tags]));
  if (entry.kifuBlocks.length === 0) return { lines: [], imported: 0, failed: false, empty: true };

  const lines: string[] = [];
  let imported = 0;
  let failed = false;
  for (const [i, block] of entry.kifuBlocks.entries()) {
    const label = entry.kifuBlocks.length > 1 ? `${i + 1} 件目: ` : "";
    try {
      const game = await parseKifu(block, {
        source: entry.url ? { ...source, kind: "url", url: entry.url } : source,
        tags,
        memo: entry.memo,
      });
      if (game.length < MIN_MOVES) {
        throw new Error(`指し手が少なすぎます (${game.length}手)`);
      }
      if (ctx.known.has(game.id)) {
        lines.push(`- ${label}既に登録済み (\`${game.id}\`)`);
        continue;
      }
      if (!dryRun) await saveJson(path.join(dataDir, "games", `${game.id}.json`), game);
      const summary = toSummary(game);
      ctx.known.set(game.id, game.id);
      ctx.index.games.push(summary);
      ctx.changed = true;
      imported++;
      lines.push(
        `- ${label}☗${game.black} vs ☖${game.white} (${game.startedAt ?? "日付不明"}) ${GAME_SHAPE_LABEL[game.opening.shape]} ${game.length}手 → \`${game.id}\``,
      );
    } catch (e) {
      failed = true;
      lines.push(`- ${label}読み込み失敗: ${(e as Error).message}`);
    }
  }
  return { lines, imported, failed, empty: false };
}

async function main(): Promise<void> {
  const issues = (await listAll<Issue>(`/repos/${dataRepo}/issues?state=open`)).filter(
    (i) => !i.pull_request && !i.labels.some((l) => l.name === SKIP_LABEL),
  );
  console.log(`対象 Issue: ${issues.length} 件`);

  const indexFile = path.join(dataDir, "index.json");
  const stateFile = path.join(dataDir, "inbox-state.json");
  const index = await loadJson<GameIndex>(indexFile, {
    schema: 1,
    updatedAt: new Date().toISOString(),
    games: [],
  });
  const state = await loadJson<InboxState>(stateFile, { schema: 1, issues: {}, comments: {} });
  const ctx: Context = {
    index,
    known: new Map(index.games.map((g) => [g.id, g.id] as const)),
    changed: false,
  };
  let stateChanged = false;
  let totalImported = 0;

  for (const issue of issues) {
    const issueKey = String(issue.number);

    // 本文
    if (state.issues[issueKey] !== issue.updated_at) {
      const r = await processText(ctx, issue.body ?? "", issue, {
        kind: "issue",
        issue: issue.number,
      });
      if (!r.empty) {
        await react({ issue: issue.number }, r.failed ? "confused" : "rocket");
        if (r.failed)
          await comment(
            issue.number,
            `本文の棋譜を読み込めませんでした。本文を直すと再処理します。\n\n${r.lines.join("\n")}\n\n(自動処理)`,
          );
        else console.log(`#${issue.number} 本文:\n${r.lines.join("\n")}`);
      }
      state.issues[issueKey] = issue.updated_at;
      stateChanged = true;
      totalImported += r.imported;
    }

    // コメント
    const comments = await listAll<Comment>(`/repos/${dataRepo}/issues/${issue.number}/comments`);
    for (const c of comments) {
      if (c.user.type === "Bot") continue;
      if (state.comments[String(c.id)] === c.updated_at) continue;
      const r = await processText(ctx, c.body ?? "", issue, {
        kind: "issue",
        issue: issue.number,
        comment: c.id,
      });
      if (!r.empty) {
        await react({ comment: c.id }, r.failed ? "confused" : "rocket");
        if (r.failed)
          await comment(
            issue.number,
            `コメントの棋譜を読み込めませんでした。コメントを編集すると再処理します。\n\n${r.lines.join("\n")}\n\n(自動処理)`,
          );
        else console.log(`#${issue.number} コメント ${c.id}:\n${r.lines.join("\n")}`);
      }
      state.comments[String(c.id)] = c.updated_at;
      stateChanged = true;
      totalImported += r.imported;
    }
  }

  if (ctx.changed && !dryRun) {
    index.games.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
    index.updatedAt = new Date().toISOString();
    await saveJson(indexFile, index);
  }
  if (stateChanged && !dryRun) await saveJson(stateFile, state);
  console.log(`取り込み: ${totalImported} 局 / リポジトリ全体: ${index.games.length} 局`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
