import type { Page } from "@playwright/test";
import { parseKifu } from "../src/core/parse";
import { toSummary, type GameRecord } from "../src/core/types";
import {
  USI_ANAGUMA_VS_SHIKEN,
  USI_KAKUGAWARI,
  USI_SHIKEN_VS_FUNA,
} from "../src/core/__tests__/fixtures";

const source = { kind: "issue" as const, issue: 1 };

/** テスト用の架空の対局 4 局 (taro の四間飛車 3 局 + 角換わり 1 局) */
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

/** GitHub Contents API をモックしてデータリポジトリの代わりにする */
export async function mockDataRepo(page: Page, games: GameRecord[]): Promise<void> {
  const headers = { "access-control-allow-origin": "*", "content-type": "application/json" };
  await page.route("https://api.github.com/**", (route) => {
    const path = /contents\/(.+?)\?/.exec(route.request().url())?.[1] ?? "";
    if (path === "index.json") {
      return route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({ schema: 1, updatedAt: "x", games: games.map(toSummary) }),
      });
    }
    const id = /games\/(.+)\.json/.exec(path)?.[1];
    const game = games.find((g) => g.id === id);
    return route.fulfill({ status: game ? 200 : 404, headers, body: JSON.stringify(game ?? {}) });
  });
}

export async function syncWithMock(page: Page, games: GameRecord[]): Promise<void> {
  await mockDataRepo(page, games);
  await page.goto("#/settings");
  await page.fill("input[type=password]", "github_pat_dummy");
  await page.click("text=同期する");
  await page.waitForSelector("text=同期完了");
}
