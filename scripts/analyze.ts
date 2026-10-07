/**
 * データリポジトリの対局をエンジンで解析し、analysis/<id>.json と analysis/<id>.kif を書く。
 *
 * 環境変数:
 *   DATA_DIR      データリポジトリ (既定: ../shogi-atlas-data)
 *   DEPTH         探索深さ (既定: 14)
 *   THREADS       スレッド数 (既定: CPU 数、最大 4)
 *   MAX_GAMES     1 回の実行で解析する最大局数 (既定: 20)
 *   TIME_BUDGET   1 回の実行の解析時間の上限 (秒)。残り時間が 1 局の最悪見積もりに足りなければ新しい対局を始めず、
 *                 途中の対局も予算を超えそうなら打ち切って次回に回す (scripts/budget.ts。既定: 5400)
 *   MOVE_TIME_LIMIT 1 局面の探索時間の上限 (秒)。超えたら stop で打ち切り、到達した深さを plies[].depth に残す (既定: 20、0 で無制限)
 *   ONLY          対局者名。指定するとその人の対局だけを優先する
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  MATE_CP,
  isAnalysisStale,
  normalizeAnalysis,
  type AnalysisRecord,
  type PlyEval,
} from "../src/core/analysis";
import { annotatedKif } from "../src/core/annotate";
import { normalizeGame } from "../src/core/normalize";
import type { GameRecord } from "../src/core/types";
import { canStartGame, canStartPly, type BudgetState } from "./budget";
import { Engine } from "./engine";

const dataDir = path.resolve(process.env.DATA_DIR ?? "../shogi-atlas-data");
const depth = Number(process.env.DEPTH ?? 14);
const maxGames = Number(process.env.MAX_GAMES ?? 20);
const timeBudget = Number(process.env.TIME_BUDGET ?? 5400) * 1000;
const moveTimeLimit = Number(process.env.MOVE_TIME_LIMIT ?? 20) * 1000;
const only = process.env.ONLY;

export const ANALYZER_VERSION = 1;

function toBlackCp(
  cp: number | null,
  mate: number | null,
  blackToMove: boolean,
): { cp: number; mate?: number } {
  let value: number;
  let mateOut: number | undefined;
  if (mate !== null) {
    value = mate > 0 ? MATE_CP : -MATE_CP;
    mateOut = mate;
  } else {
    value = Math.max(-MATE_CP, Math.min(MATE_CP, cp ?? 0));
  }
  const result: { cp: number; mate?: number } = { cp: blackToMove ? value : -value };
  if (mateOut !== undefined) result.mate = mateOut;
  return result;
}

/** 途中で殺されても壊れたファイルを残さないよう、一時ファイルに書いてから置き換える */
async function writeAtomic(file: string, body: string): Promise<void> {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, body);
  await rename(tmp, file);
}

/** 予算を超えそうなら null を返す (その対局は書かずに次回に回す) */
async function analyzeGame(
  engine: Engine,
  game: GameRecord,
  budget: () => BudgetState,
): Promise<{ analysis: AnalysisRecord; stopped: number } | null> {
  const moves = game.usi
    .replace(/^position startpos( moves)?\s*/, "")
    .split(/\s+/)
    .filter(Boolean);
  const plies: PlyEval[] = [];
  let stopped = 0;
  for (let ply = 0; ply <= moves.length; ply++) {
    if (!canStartPly(budget())) return null;
    const usi =
      ply === 0 ? "position startpos" : `position startpos moves ${moves.slice(0, ply).join(" ")}`;
    const r = await engine.analyze(usi, depth, moveTimeLimit);
    const blackToMove = ply % 2 === 0;
    const { cp, mate } = toBlackCp(r.cp, r.mate, blackToMove);
    const entry: PlyEval = { ply, cp };
    if (mate !== undefined) entry.mate = mate;
    if (r.stopped) {
      stopped++;
      entry.depth = r.depth;
    }
    if (r.bestmove && r.bestmove !== "resign" && r.bestmove !== "win") {
      entry.best = r.bestmove;
      if (r.pv.length) entry.pv = r.pv.slice(0, 8);
    }
    plies.push(entry);
  }
  const analysis: AnalysisRecord = {
    schema: 1,
    id: game.id,
    engine: { name: `${engine.name} v${ANALYZER_VERSION}`, depth },
    analyzedAt: new Date().toISOString(),
    game: { importedAt: game.importedAt, length: game.length, usi: game.usi },
    plies,
  };
  return { analysis, stopped };
}

async function main(): Promise<void> {
  const gamesDir = path.join(dataDir, "games");
  const outDir = path.join(dataDir, "analysis");
  await mkdir(outDir, { recursive: true });
  // 前回殺されたときの書きかけ
  for (const f of await readdir(outDir)) {
    if (f.endsWith(".tmp")) await rm(path.join(outDir, f));
  }
  const files = (await readdir(gamesDir)).filter((f) => f.endsWith(".json"));
  const games: GameRecord[] = [];
  for (const f of files) {
    const g = normalizeGame(JSON.parse(await readFile(path.join(gamesDir, f), "utf8")));
    if (g) games.push(g);
  }
  const needs = async (g: GameRecord) => {
    const file = path.join(outDir, `${g.id}.json`);
    if (!existsSync(file)) return true;
    try {
      const a = normalizeAnalysis(JSON.parse(await readFile(file, "utf8")));
      return !a || isAnalysisStale(g, a);
    } catch {
      return true;
    }
  };
  const flags = await Promise.all(games.map(needs));
  const pending = games
    .filter((_, i) => flags[i])
    .sort((a, b) => {
      const pa = only && (a.black === only || a.white === only) ? 0 : 1;
      const pb = only && (b.black === only || b.white === only) ? 0 : 1;
      return pa - pb || (b.startedAt ?? "").localeCompare(a.startedAt ?? "");
    })
    .slice(0, maxGames);
  const total = flags.filter(Boolean).length;
  console.log(`未解析・要再解析 ${total} 局のうち ${pending.length} 局を解析 (深さ ${depth})`);
  if (pending.length === 0) return;

  const engine = await Engine.create();
  const started = Date.now();
  const budget = (): BudgetState => ({
    elapsedMs: Date.now() - started,
    budgetMs: timeBudget,
    moveTimeLimitMs: moveTimeLimit,
  });
  let done = 0;
  let skipped = 0;
  let stoppedTotal = 0;
  try {
    for (const game of pending) {
      if (!canStartGame(budget(), game.length, done)) {
        skipped++;
        continue;
      }
      const t = Date.now();
      const result = await analyzeGame(engine, game, budget);
      if (!result) {
        console.log(`${game.id}: 時間の上限に達したので途中で打ち切り、次回に回します`);
        skipped++;
        break;
      }
      const { analysis, stopped } = result;
      stoppedTotal += stopped;
      // .kif を先に置く。.json が無ければ次回も未解析として扱われるので、間で殺されても両方書き直される
      await writeAtomic(path.join(outDir, `${game.id}.kif`), annotatedKif(game, analysis));
      await writeAtomic(path.join(outDir, `${game.id}.json`), JSON.stringify(analysis) + "\n");
      done++;
      console.log(
        `${game.id} ☗${game.black} vs ☖${game.white} ${game.length}手: ${Math.round((Date.now() - t) / 1000)}s` +
          (stopped ? ` (打ち切り ${stopped} 局面)` : ""),
      );
    }
  } finally {
    engine.quit();
  }
  console.log(
    `解析完了: ${done} 局 (${Math.round((Date.now() - started) / 1000)}s` +
      (stoppedTotal ? `, 時間上限で打ち切った局面 ${stoppedTotal}` : "") +
      ")" +
      (skipped ? `。時間が足りず次回に回した対局 ${skipped}` : ""),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
