import type { Page } from "@playwright/test";
import { parseKifu } from "../src/core/parse";
import { toSummary, type GameRecord } from "../src/core/types";
import type { AnalysisRecord } from "../src/core/analysis";
import {
  USI_ANAGUMA_VS_SHIKEN,
  USI_KAKUGAWARI,
  USI_SHIKEN_VS_FUNA,
  USI_TSUMERO_A,
} from "../src/core/__tests__/fixtures";

const source = { kind: "issue" as const, issue: 1 };

/** テスト用の架空の対局 4 局 (taro のノーマル四間飛車 3 局 + 角換わり 1 局) */
export async function fixtureGames(): Promise<GameRecord[]> {
  const a = await parseKifu(USI_SHIKEN_VS_FUNA, { source, tags: ["taro"] });
  const b = await parseKifu(USI_SHIKEN_VS_FUNA.replace("1g1f 1c1d", "9g9f 9c9d"), {
    source,
    tags: ["taro"],
  });
  const c = await parseKifu(USI_ANAGUMA_VS_SHIKEN, { source, tags: ["taro"] });
  const d = await parseKifu(USI_KAKUGAWARI, { source });
  Object.assign(a, {
    black: "taro",
    white: "jiro",
    result: "black",
    startedAt: "2026-10-01T10:00:00",
    blackRank: "二段",
  });
  Object.assign(b, {
    black: "taro",
    white: "saburo",
    result: "white",
    startedAt: "2026-10-02T10:00:00",
  });
  Object.assign(c, {
    black: "hanako",
    white: "taro",
    result: "white",
    startedAt: "2026-10-03T10:00:00",
  });
  Object.assign(d, {
    black: "jiro",
    white: "hanako",
    result: "black",
    startedAt: "2026-10-04T10:00:00",
  });
  return [a, b, c, d].map((g, i) => ({ ...g, id: `f${i}`.padEnd(16, "0") }));
}

/** 自分の 2 つの ID (将棋ウォーズとクエスト) の対局 2 局と、登録した相手 rival と自分の対局 1 局 */
export async function fixtureSelfGames(): Promise<{ games: GameRecord[]; self: string[] }> {
  const self = ["me_wars", "me_quest"];
  const a = await parseKifu(USI_SHIKEN_VS_FUNA, { source, tags: ["me_wars", "自分"] });
  const b = await parseKifu(USI_SHIKEN_VS_FUNA.replace("1g1f 1c1d", "9g9f 9c9d"), {
    source,
    tags: ["me_quest", "自分"],
  });
  const c = await parseKifu(USI_ANAGUMA_VS_SHIKEN, { source, tags: ["rival"] });
  Object.assign(a, { black: "me_wars", white: "x1", result: "black", blackRank: "二段" });
  Object.assign(a, { startedAt: "2026-10-01T10:00:00" });
  Object.assign(b, { black: "me_quest", white: "x2", result: "white", blackRating: 1500 });
  Object.assign(b, { startedAt: "2026-10-02T10:00:00" });
  Object.assign(c, { black: "rival", white: "me_wars", result: "white" });
  Object.assign(c, { startedAt: "2026-10-03T10:00:00" });
  const games = [a, b, c].map((g, i) => ({ ...g, id: `e${i}`.padEnd(16, "0") }));
  return { games, self };
}

/** 先頭の対局に架空のエンジン解析を付ける (15 手目で先手が大悪手) */
export function fixtureAnalyses(games: GameRecord[]): AnalysisRecord[] {
  const g = games[0]!;
  const cps = Array.from({ length: g.length + 1 }, (_, i) => (i >= 15 ? -900 : 0));
  return [
    {
      schema: 1,
      id: g.id,
      engine: { name: "fake", depth: 1 },
      analyzedAt: "2026-01-01T00:00:00Z",
      plies: cps.map((cp, ply) =>
        ply === 14 ? { ply, cp, best: "1g1f", pv: ["1g1f"] } : { ply, cp },
      ),
    },
  ];
}

/** 詰めろの問題 (▲2三歩 → △1三歩 → ▲2二金 で詰み) が 1 問できる対局と、その解析 */
export async function fixtureMateGame(): Promise<{
  games: GameRecord[];
  analyses: AnalysisRecord[];
}> {
  const g = await parseKifu(USI_TSUMERO_A, { source });
  Object.assign(g, { black: "taro", white: "jiro", result: "black", id: "c9".padEnd(16, "0") });
  Object.assign(g, { startedAt: "2026-10-05T10:00:00" });
  const plies = [
    { ply: 0, cp: 800, best: "2d2c" },
    { ply: 1, cp: 3000, mate: -3 },
    { ply: 2, cp: 3000, mate: 1, best: "G*2b" },
    { ply: 3, cp: 3000 },
  ];
  const analysis: AnalysisRecord = {
    schema: 1,
    id: g.id,
    engine: { name: "fake", depth: 1 },
    analyzedAt: "2026-01-01T00:00:00Z",
    plies,
  };
  return { games: [g], analyses: [analysis] };
}

/** GitHub Contents API をモックしてデータリポジトリの代わりにする */
export async function mockDataRepo(
  page: Page,
  games: GameRecord[],
  analyses: AnalysisRecord[] = [],
  reports: Record<string, string> = {},
  self: string[] = [],
): Promise<void> {
  const headers = { "access-control-allow-origin": "*", "content-type": "application/json" };
  await page.route("https://api.github.com/**", (route) => {
    const path = /contents\/(.+?)\?/.exec(route.request().url())?.[1] ?? "";
    if (path === "index.json") {
      return route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({ schema: 1, updatedAt: "x", games: games.map(toSummary), self }),
      });
    }
    if (path === "analysis/index.json") {
      const index = Object.fromEntries(analyses.map((a) => [a.id, a.analyzedAt]));
      return route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({ schema: 1, analyses: index }),
      });
    }
    // 対策レポート: players/ と players/<名前>/ の一覧、report.md の本文
    if (path === "players") {
      const dirs = Object.keys(reports).map((name) => ({ name, type: "dir", sha: "d" }));
      return route.fulfill({ status: 200, headers, body: JSON.stringify(dirs) });
    }
    const dir = /^players\/([^/]+)$/.exec(path)?.[1];
    if (dir) {
      const md = reports[decodeURIComponent(dir)];
      const entries = md === undefined ? [] : [{ name: "report.md", type: "file", sha: "r1" }];
      return route.fulfill({ status: 200, headers, body: JSON.stringify(entries) });
    }
    const reportOf = /^players\/(.+)\/report\.md$/.exec(path)?.[1];
    if (reportOf) {
      const md = reports[decodeURIComponent(reportOf)];
      return route.fulfill({
        status: md === undefined ? 404 : 200,
        headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
        body: md ?? "",
      });
    }
    const aid = /analysis\/(.+)\.json/.exec(path)?.[1];
    if (aid) {
      const a = analyses.find((x) => x.id === aid);
      return route.fulfill({ status: a ? 200 : 404, headers, body: JSON.stringify(a ?? {}) });
    }
    const id = /games\/(.+)\.json/.exec(path)?.[1];
    const game = games.find((g) => g.id === id);
    return route.fulfill({ status: game ? 200 : 404, headers, body: JSON.stringify(game ?? {}) });
  });
}

export async function syncWithMock(
  page: Page,
  games: GameRecord[],
  analyses: AnalysisRecord[] = [],
  reports: Record<string, string> = {},
  self: string[] = [],
): Promise<void> {
  await mockDataRepo(page, games, analyses, reports, self);
  await page.goto("#/settings");
  await page.fill("input[type=password]", "github_pat_dummy");
  await page.click("text=同期する");
  await page.waitForSelector("text=同期完了");
}
