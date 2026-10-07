import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { fixtureReport } from "../src/core/__tests__/fixtures";
import { fixtureAnalyses, fixtureGames, fixtureSelfGames, syncWithMock } from "./fixture";

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
    // 先頭のカード: 局数と解析済み、勝率と先後、レーダーチャートがスクロールなしで見える
    const card = page.locator(".profile-card");
    await expect(card.getByText("1/3 局", { exact: true })).toBeInViewport();
    await expect(card.getByText(/^勝率 · /)).toBeInViewport();
    await expect(card.getByText(/^先手 \d+ 局/)).toBeInViewport();
    await expect(page.getByRole("img", { name: /レーダーチャート/ })).toBeInViewport();
    // 全対局の一覧はページに無く、局数のタイルからその人で絞った棋譜一覧へ飛んで戻る
    await expect(page.getByText("対局一覧", { exact: true })).toHaveCount(0);
    await expect(page.locator("ul.games")).toHaveCount(0);
    await card.getByRole("link", { name: /1\/3 局/ }).click();
    await expect(page).toHaveURL(/#\/games\?player=taro$/);
    await expect(page.getByText("3 / 4 局")).toBeVisible();
    await expect(page.locator("ul.games li")).toHaveCount(3);
    await page.getByRole("button", { name: "← taro" }).click();
    await expect(page).toHaveURL(/#\/player\/taro$/);
    await expect(page.getByText("痛かった手")).toBeVisible();
    await expect(page.locator("details.worst[open]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "局面を開く" }).first()).toBeHidden();
    // 率をタップすると内訳が開き、根拠の局面へ飛べる (15 手目で -900 → 初めて不利になった局面)
    await page.getByRole("button", { name: /粘り/ }).click();
    await expect(page.locator("details.rate-row")).toHaveCount(1);
    await page.locator("details.rate-row summary").click();
    await page.locator("details.rate-row").getByRole("button", { name: "局面を開く" }).click();
    await expect(page).toHaveURL(/#\/game\/f000000000000000\/15/);
    await page.goBack();
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
    // 解析済みの a は最善、b は未解析 → 正しく指せた分岐
    await expect(branches.locator(".branch-kind.correct")).toContainText(
      "本人の手: ▲1六歩 ×1 (最善) / ▲9六歩 ×1 (未解析)",
    );
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
      .getByRole("link", { name: "ノーマル四間飛車" })
      .click();
    await expect(page).toHaveURL(/#\/games\?player=taro&opening=[^&]+&openingSide=self$/);
    await expect(page.getByText("絞り込み · taro · ノーマル四間飛車(本人)")).toBeVisible();
    await expect(page.locator("ul.games li")).toHaveCount(3);
    await expect(page.getByText("3 / 4 局")).toBeVisible();
    // 条件を足して URL に乗せ、戻るで前の条件に戻り、一括で消す
    await page.locator("details.filters summary").click();
    await page.getByLabel("勝敗").selectOption("win");
    await expect(page).toHaveURL(/&result=win$/);
    await page.goBack();
    await expect(page.getByLabel("勝敗")).toHaveValue("");
    await expect(page.getByText("3 / 4 局")).toBeVisible();
    await page.getByRole("button", { name: "条件をすべて消す" }).click();
    await expect(page.getByText("4 / 4 局")).toBeVisible();
    // #6 の形式の URL も同じ絞り込みで開く
    await page.goto(`#/player/taro/games/opening/${encodeURIComponent("ノーマル四間飛車")}`);
    await expect(page.getByText("3 / 4 局")).toBeVisible();

    // 戦型ポートフォリオ: 畳まれた条件を開き、行から該当対局の一覧へ
    await page.goto("#/player/taro");
    const portfolio = page.locator(".panel", { hasText: "戦型ポートフォリオ" });
    await expect(portfolio.locator("details.portfolio[open]")).toHaveCount(0);
    await portfolio.locator("details.portfolio summary").first().click();
    // 相手の戦法ごとの繰り返し手順: 18 手目まで 2 局が同じ。手をタップすると盤面と対局へのボタン
    const lines = portfolio.locator("details.portfolio[open] details.lines").first();
    await expect(lines.locator("summary")).toContainText("幹 18 手目まで 2 局");
    await lines.locator("summary").click();
    await expect(lines.locator(".line-move").first()).toHaveText("▲7六歩 (2)");
    await expect(lines.locator("svg.board")).toBeHidden();
    await lines.getByRole("button", { name: "△5四歩" }).click();
    await expect(lines.locator("svg.board")).toBeVisible();
    await lines.locator(".detail-body button").first().click();
    await expect(page).toHaveURL(/#\/game\/[0-9a-f]+\/18$/);
    await page.goBack();
    // 戻ると開いていた折りたたみがそのまま
    await expect(lines).toHaveAttribute("open", "");
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

  test("対局者ページ → 棋譜 → 戻るで同じ位置・同じ折りたたみに戻る", async ({ page }) => {
    const games = await fixtureGames();
    await syncWithMock(page, games, fixtureAnalyses(games));
    await expect(page.getByText(/同期完了/)).toBeVisible();

    await page.goto("#/player/taro");
    const worst = page.locator("details.worst").first();
    await worst.locator("summary").click();
    await worst.scrollIntoViewIfNeeded();
    const y = await page.evaluate<number>("scrollY");
    expect(y).toBeGreaterThan(0);
    await worst.getByRole("button", { name: "局面を開く" }).click();
    await expect(page).toHaveURL(/#\/game\/f000000000000000\/14/);
    await page.getByRole("button", { name: "← 戻る" }).click();
    await expect(page).toHaveURL(/#\/player\/taro$/);
    await expect(page.locator("details.worst").first()).toHaveAttribute("open", "");
    await expect.poll(() => page.evaluate<number>("scrollY")).toBe(y);

    // 棋譜の URL を直接開いたときは本人の対局者ページへ
    const direct = await page.context().newPage();
    await direct.goto("#/game/f000000000000000");
    await direct.getByRole("button", { name: "← 戻る" }).click();
    await expect(direct).toHaveURL(/#\/player\/taro$/);
    await expect(direct.getByText("痛かった手")).toBeVisible();

    expect((page as unknown as { errors: string[] }).errors).toEqual([]);
  });

  test("対策レポート: 同期 → 印 → 要点と全文 → 棋譜の手数へ", async ({ page }) => {
    const games = await fixtureGames();
    await syncWithMock(page, games, [], { taro: fixtureReport("taro", games[0]!.id) });

    await page.goto("#/players");
    const row = page.locator("ul.games li", { hasText: "taro" });
    await expect(row.getByText("新しいレポート")).toBeVisible();
    await row.click();

    const panel = page.locator(".panel.report");
    await expect(panel.getByText("新しいレポート")).toBeVisible();
    const digest = panel.locator("details.report-part", { hasText: "対策の要点" });
    await expect(digest.getByText("居飛車穴熊にする。")).toBeHidden();
    await digest.locator("summary").click();
    await expect(digest.getByText("居飛車穴熊にする。")).toBeVisible();
    await expect(panel.getByText("新しいレポート")).toHaveCount(0);
    await panel.locator("summary", { hasText: "全文" }).click();
    await panel.getByRole("link", { name: `${games[0]!.id} 15手目` }).click();
    await expect(page).toHaveURL(/#\/game\/f000000000000000\/14$/);
    await expect(page.getByText("14 手目")).toBeVisible();

    await page.goto("#/players");
    await expect(page.locator("ul.games li", { hasText: "taro" })).toBeVisible();
    await expect(page.getByText("新しいレポート")).toHaveCount(0);
    expect((page as unknown as { errors: string[] }).errors).toEqual([]);
  });

  test("対局者ページ → 画像で共有 → 共有シートの無い環境ではダウンロード", async ({ page }) => {
    // 共有シート (Web Share API) の無い環境を前提にする
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", { value: undefined });
    });
    const games = await fixtureGames();
    await syncWithMock(page, games, fixtureAnalyses(games), {
      taro: fixtureReport("taro", games[0]!.id),
    });
    await page.goto("#/player/taro");
    await expect(page.locator(".profile-card")).toBeVisible();
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "画像で共有" }).click();
    const file = await downloading;
    expect(file.suggestedFilename()).toMatch(/^shogi-atlas-taro-\d{4}-\d{2}-\d{2}\.png$/);
    const png = await readFile(await file.path());
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    // 横 1080 (540 × 2) の縦長
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBeGreaterThan(1080);
    // 出来た画像がページにも出て、保存し直せる
    const preview = page.getByRole("img", { name: "taro の対策 1 枚" });
    await expect(preview).toBeVisible();
    expect(
      await preview.evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth),
    ).toBe(1080);
    await expect(page.getByRole("link", { name: "保存" })).toBeVisible();
    expect((page as unknown as { errors: string[] }).errors).toEqual([]);
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

  test("自分の 2 つの ID が「自分」1 人にまとまり、どの画面にも ID が出ない", async ({ page }) => {
    const { games, self } = await fixtureSelfGames();
    await syncWithMock(page, games, [], {}, self);
    const noIds = async () => {
      const html = await page.content();
      for (const id of self) expect(html).not.toContain(id);
      for (const id of self) expect(decodeURIComponent(page.url())).not.toContain(id);
    };

    await page.goto("#/");
    await expect(page.locator("ul.games li")).toHaveCount(3);
    await noIds();

    await page.click("text=対局者");
    const first = page.locator("ul.games li").first();
    await expect(first).toContainText("自分");
    await expect(first).toContainText("3 局 · 2 勝 1 敗");
    await expect(page.locator("ul.games li")).toHaveCount(2);
    await noIds();

    await first.click();
    await expect(page).toHaveURL(/#\/player\/%E8%87%AA%E5%88%86$/);
    await expect(page.locator(".profile-card")).toContainText("マイページ");
    await expect(page.locator(".profile-card")).toContainText("0/3 局");
    await noIds();

    // 相手のページは今までどおり。相手との対局は相手が手前
    await page.goto("#/player/rival");
    await expect(page.locator(".profile-card")).toContainText("0/1 局");
    await page.goto(`#/game/${games[2]!.id}`);
    await expect(page.locator(".side-row").nth(1)).toContainText("☗ rival");
    await expect(page.locator(".side-row").nth(0)).toContainText("☖ 自分");
    await noIds();
    expect((page as unknown as { errors: string[] }).errors).toEqual([]);
  });
});
