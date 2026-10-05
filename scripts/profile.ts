/**
 * 解析済みの対局から対局者ごとの弱点プロファイルを作り、players/<name>/profile.{json,md} に書く。
 * 対象は Issue で登録した対局者 (タグに自分の名前が入っている人)。
 *
 *   DATA_DIR=../shogi-atlas-data pnpm build-profiles
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { AnalysisRecord } from "../src/core/analysis";
import { normalizeGame } from "../src/core/normalize";
import { buildPlayerProfile, profileToMarkdown } from "../src/core/profile";
import { listPlayers } from "../src/core/stats";
import type { GameRecord } from "../src/core/types";

const dataDir = path.resolve(process.env.DATA_DIR ?? "../shogi-atlas-data");

async function main(): Promise<void> {
  const gamesDir = path.join(dataDir, "games");
  const analysisDir = path.join(dataDir, "analysis");
  const games: GameRecord[] = [];
  for (const f of (await readdir(gamesDir)).filter((f) => f.endsWith(".json"))) {
    const g = normalizeGame(JSON.parse(await readFile(path.join(gamesDir, f), "utf8")));
    if (g) games.push(g);
  }
  const analyses = new Map<string, AnalysisRecord>();
  for (const g of games) {
    const file = path.join(analysisDir, `${g.id}.json`);
    if (existsSync(file))
      analyses.set(g.id, JSON.parse(await readFile(file, "utf8")) as AnalysisRecord);
  }
  // アプリが「どの対局に解析があるか」を 1 回の取得で知るための一覧
  const index: Record<string, string> = {};
  for (const [id, a] of analyses) index[id] = a.analyzedAt;
  await mkdir(analysisDir, { recursive: true });
  await writeFile(
    path.join(analysisDir, "index.json"),
    JSON.stringify({ schema: 1, analyses: index }, null, 2) + "\n",
  );
  console.log(`analysis/index.json: ${analyses.size} 局`);

  const players = listPlayers(games).filter((p) => p.tracked);
  for (const p of players) {
    const profile = buildPlayerProfile(games, analyses, p.name, { worstMoves: 15 });
    const dir = path.join(dataDir, "players", p.name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "profile.json"), JSON.stringify(profile, null, 2) + "\n");
    await writeFile(path.join(dir, "profile.md"), profileToMarkdown(profile));
    console.log(`${p.name}: 解析済み ${profile.games} / ${p.games} 局`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
