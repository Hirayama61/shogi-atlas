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
    await expect(page.locator('input[type="search"]')).toHaveCount(0);
    await page.locator("ul.games li", { hasText: "角換わり" }).click();

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
    await expect(page.locator("details.worst[open]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "局面を開く" }).first()).toBeHidden();
    await page.locator("details.worst summary").first().click();
    await page.getByRole("button", { name: "局面を開く" }).first().click();
    await expect(page).toHaveURL(/#\/game\/f000000000000000\/14/);
    await expect(page.getByRole("img", { name: "評価値の推移" })).toBeVisible();
    await expect(page.getByText("解析つき KIF をコピー")).toBeVisible();
    await page.goBack();
    const branches = page.locator(".panel", {
      has: page.locator("strong", { hasText: /^分岐点$/ }),
    });
    await expect(branches.getByText(/18 手目まで共通 · 2 局/)).toBeVisible();
    await expect(branches.locator(".branch svg.board")).toBeHidden();
    await branches.locator(".branch summary").first().click();
    await expect(branches.locator(".branch svg.board").first()).toBeVisible();
    await branches.locator(".branch button").first().click();
    await expect(page).toHaveURL(/#\/game\/f000000000000000\/18/);
    await expect(page.getByText("18 手目")).toBeVisible();

    // 採用戦法の行から、その戦法の対局一覧へ
    await page.goto("#/player/taro");
    await page
      .locator(".panel", { hasText: "採用戦法" })
      .getByRole("link", { name: "四間飛車" })
      .click();
    await expect(page).toHaveURL(/#\/player\/taro\/games\/opening\//);
    await expect(page.getByText("採用戦法: 四間飛車")).toBeVisible();
    await expect(page.locator("ul.games li")).toHaveCount(3);
    await expect(page.getByText("3 / 3 局")).toBeVisible();

    // 戦型ポートフォリオ: 畳まれた条件を開き、行から該当対局の一覧へ
    await page.goto("#/player/taro");
    const portfolio = page.locator(".panel", { hasText: "戦型ポートフォリオ" });
    await expect(portfolio.locator("details.portfolio[open]")).toHaveCount(0);
    await portfolio.locator("details.portfolio summary").first().click();
    await portfolio.locator("details.portfolio[open] tbody tr a").first().click();
    await expect(page).toHaveURL(/#\/player\/taro\/portfolio\//);
    await expect(page.getByText(/相手: /).first()).toBeVisible();
    await expect(page.locator("ul.games li").first()).toBeVisible();

    // 外した検索ルートで開いてもトップの一覧になる
    await page.goto("#/search");
    await expect(page.locator("ul.games li")).toHaveCount(4);

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

  test("更新情報: タブの印が開くと消える", async ({ page }) => {
    await page.goto("#/");
    const tab = page.getByRole("button", { name: /更新情報/ });
    await expect(tab.getByLabel("未読の更新あり")).toBeVisible();
    await tab.click();
    await expect(page).toHaveURL(/#\/updates/);
    await expect(page.getByRole("heading", { name: "更新情報" })).toBeVisible();
    // 先頭の見出しは機能を足すたびに変わるので、日付つきの項目が並ぶことだけ見る
    await expect(page.locator("ul.changelog > li").first().locator("time")).toHaveText(
      /^\d{4}-\d{2}-\d{2}$/,
    );
    await expect(tab.getByLabel("未読の更新あり")).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("button", { name: /更新情報/ }).getByLabel("未読の更新あり"),
    ).toHaveCount(0);
    expect((page as unknown as { errors: string[] }).errors).toEqual([]);
  });
});
