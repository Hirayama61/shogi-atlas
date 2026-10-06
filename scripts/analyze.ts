/**
 * データリポジトリの対局をエンジンで解析し、analysis/<id>.json と analysis/<id>.kif を書く。
 *
 * 環境変数:
 *   DATA_DIR      データリポジトリ (既定: ../shogi-atlas-data)
 *   DEPTH         探索深さ (既定: 14)
 *   THREADS       スレッド数 (既定: CPU 数、最大 4)
 *   MAX_GAMES     1 回の実行で解析する最大局数 (既定: 20)
 *   TIME_BUDGET   1 回の実行の目安時間 (秒)。超えたら新しい対局を始めない (既定: 5400)
 *   ONLY          対局者名。指定するとその人の対局だけを優先する
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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
import { Engine } from "./engine";

const dataDir = path.resolve(process.env.DATA_DIR ?? "../shogi-atlas-data");
const depth = Number(process.env.DEPTH ?? 14);
const maxGames = Number(process.env.MAX_GAMES ?? 20);
const timeBudget = Number(process.env.TIME_BUDGET ?? 5400) * 1000;
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

async function analyzeGame(engine: Engine, game: GameRecord): Promise<AnalysisRecord> {
  const moves = game.usi
    .replace(/^position startpos( moves)?\s*/, "")
    .split(/\s+/)
    .filter(Boolean);
  const plies: PlyEval[] = [];
  for (let ply = 0; ply <= moves.length; ply++) {
    const usi =
      ply === 0 ? "position startpos" : `position startpos moves ${moves.slice(0, ply).join(" ")}`;
    const r = await engine.analyze(usi, depth);
    const blackToMove = ply % 2 === 0;
    const { cp, mate } = toBlackCp(r.cp, r.mate, blackToMove);
    const entry: PlyEval = { ply, cp };
    if (mate !== undefined) entry.mate = mate;
    if (r.bestmove && r.bestmove !== "resign" && r.bestmove !== "win") {
      entry.best = r.bestmove;
      if (r.pv.length) entry.pv = r.pv.slice(0, 8);
    }
    plies.push(entry);
  }
  return {
    schema: 1,
    id: game.id,
    engine: { name: `${engine.name} v${ANALYZER_VERSION}`, depth },
    analyzedAt: new Date().toISOString(),
    game: { importedAt: game.importedAt, length: game.length, usi: game.usi },
    plies,
  };
}

async function main(): Promise<void> {
  const gamesDir = path.join(dataDir, "games");
  const outDir = path.join(dataDir, "analysis");
  await mkdir(outDir, { recursive: true });
  const files = (await readdir(gamesDir)).filter((f) => f.endsWith(".json"));
  const games: GameRecord[] = [];
  for (const f of files) {
    const g = normalizeGame(JSON.parse(await readFile(path.join(gamesDir, f), "utf8")));
    if (g) games.push(g);
  }
  const needs = async (g: GameRecord) => {
    const file = path.join(outDir, `${g.id}.json`);
    if (!existsSync(file)) return true;
    const a = normalizeAnalysis(JSON.parse(await readFile(file, "utf8")));
    return !a || isAnalysisStale(g, a);
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
  let done = 0;
  try {
    for (const game of pending) {
      if (Date.now() - started > timeBudget) {
        console.log("時間の目安を超えたので残りは次回に回します");
        break;
      }
      const t = Date.now();
      const analysis = await analyzeGame(engine, game);
      await writeFile(path.join(outDir, `${game.id}.json`), JSON.stringify(analysis) + "\n");
      await writeFile(path.join(outDir, `${game.id}.kif`), annotatedKif(game, analysis));
      done++;
      console.log(
        `${game.id} ☗${game.black} vs ☖${game.white} ${game.length}手: ${Math.round((Date.now() - t) / 1000)}s`,
      );
    }
  } finally {
    engine.quit();
  }
  console.log(`解析完了: ${done} 局 (${Math.round((Date.now() - started) / 1000)}s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
