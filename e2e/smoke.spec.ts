import { expect, test } from "@playwright/test";
import { fixtureAnalyses, fixtureGames, syncWithMock } from "./fixture";

test.describe("一通りの画面", () => {
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    (page as unknown as { errors: string[] }).errors = errors;
  });

  test("同期 → 一覧 → 詳細 → 対局者 → 分岐点", async ({ page }) => {
    const games = await fixtureGames();
    await syncWithMock(page, games, fixtureAnalyses(games));
    await expect(page.getByText("同期完了: 追加 4 局、更新 0 局、解析 1 件")).toBeVisible();

    await page.goto("#/");
    await expect(page.locator("ul.games li")).toHaveCount(4);
    await expect(page.getByText("4 / 4 局")).toBeVisible();
    await page.getByPlaceholder(/絞り込み/).fill("角換わり");
    await expect(page.locator("ul.games li")).toHaveCount(1);
    await page.locator("ul.games li").first().click();

    await expect(page.locator("svg.board")).toBeVisible();
    await expect(page.getByText(/角換わり · 囲い:/).first()).toBeVisible();
    await page.getByRole("button", { name: "▶|" }).click();
    await expect(page.getByText("14 手目")).toBeVisible();

    await page.goto("#/players");
    await expect(page.locator("ul.games li")).toHaveCount(1);
    await expect(page.getByText("taro")).toBeVisible();
    await page.getByLabel("対局相手も表示").check();
    await expect(page.locator("ul.games li")).toHaveCount(4);
    await page.locator("ul.games li", { hasText: "taro" }).click();

    await expect(page.getByText("採用戦法")).toBeVisible();
    await expect(page.getByText(/解析済み 1 局/)).toBeVisible();
    await expect(page.getByText("痛かった手")).toBeVisible();
    await page.getByRole("button", { name: "局面を開く" }).first().click();
    await expect(page).toHaveURL(/#\/game\/f000000000000000\/14/);
    await expect(page.getByRole("img", { name: "評価値の推移" })).toBeVisible();
    await expect(page.getByText("解析つき KIF をコピー")).toBeVisible();
    await page.goBack();
    await expect(page.getByText(/18 手目まで共通 · 2 局/)).toBeVisible();
    await page.locator(".branch button").first().click();
    await expect(page).toHaveURL(/#\/game\/f000000000000000\/18/);
    await expect(page.getByText("18 手目")).toBeVisible();

    expect((page as unknown as { errors: string[] }).errors).toEqual([]);
    expect(await page.locator("body").textContent()).not.toContain("undefined");
  });

  test("PWA のマニフェストと Service Worker が配信される", async ({ page }) => {
    await page.goto("#/");
    const manifest = await page.evaluate(() => fetch("manifest.webmanifest").then((r) => r.status));
    const sw = await page.evaluate(() => fetch("sw.js").then((r) => r.status));
    expect(manifest).toBe(200);
    expect(sw).toBe(200);
  });
});
