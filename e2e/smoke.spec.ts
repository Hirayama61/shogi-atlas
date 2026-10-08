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

    await expect(page.locator(".quadrants")).toBeVisible();
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
    // 採用戦法・戦型ポートフォリオ・分岐点の節は無く、4 区分 → 戦法 → 戦法の詳細とたどる
    await expect(
      page.locator(".panel > strong", { hasText: /^(採用戦法|戦型ポートフォリオ|分岐点)$/ }),
    ).toHaveCount(0);
    const quadrant = page.locator("a.quadrant", { hasText: "対抗形 · 自分が振り飛車" });
    await expect(quadrant).toContainText("3 局");
    await quadrant.click();
    await expect(page).toHaveURL(/#\/player\/taro\?style=furiVsIbisha$/);
    const openings = page.locator(".opening-list");
    await openings.getByRole("link", { name: "相手の戦法" }).click();
    await expect(page).toHaveURL(/axis=opponent$/);
    await expect(openings.locator("thead th").first()).toHaveText("相手の戦法");
    await openings.getByRole("link", { name: "自分の戦法" }).click();
    await openings.getByRole("link", { name: "ノーマル四間飛車" }).click();
    await expect(page).toHaveURL(/style=furiVsIbisha&opening=/);
    const detail = page.locator(".opening-detail");
    await expect(detail).toContainText("3 局 2 勝 1 敗");
    // 1 画面 1 段: 詳細の画面には上の段 (4 区分・一覧) が残らず、先頭にパンくずがある
    await expect(page.locator(".quadrants")).toHaveCount(0);
    await expect(openings).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "現在地" })).toHaveText(
      "taro › 対抗形 · 自分が振り飛車 › ノーマル四間飛車",
    );
    const detailUrl = page.url();
    // 1 件 1 行。解析済みの a は最善、b は未解析 → 正しく指せた分岐
    const branches = detail.locator(".detail-branches");
    const row = branches.locator("a.branch-row.correct", { hasText: "18 手目 · 2 局" });
    await expect(row).toContainText("本人: ▲1六歩 (最善) / ▲9六歩 (未解析)");
    await expect(branches.locator("details")).toHaveCount(0);
    await row.click();
    await expect(page).toHaveURL(/#\/player\/taro\/branch\//);
    const ply = page.locator(".study-ply");
    await expect(ply).toHaveText("開始局面");
    await page.getByRole("button", { name: "進む" }).click();
    await expect(ply).toHaveText("1 手目 ▲7六歩");
    await page.getByRole("button", { name: "分岐点", exact: true }).click();
    await expect(ply).toHaveText("18 手目 △5四歩");
    // 盤・進む戻る・候補手がスマホの縦画面に収まる
    await expect(page.locator(".study-board svg.board")).toBeInViewport();
    await expect(page.getByRole("button", { name: "進む" })).toBeInViewport();
    const candidates = page.getByRole("group", { name: "本人の候補手" });
    await expect(candidates).toBeInViewport();
    await candidates.getByRole("button", { name: /▲9六歩/ }).click();
    await expect(ply).toHaveText("19 手目 ▲9六歩");
    await page.getByRole("button", { name: /^棋譜で開く/ }).click();
    await expect(page).toHaveURL(/#\/game\/[0-9a-f]+\/19/);
    await expect(page.getByText("19 手目")).toBeVisible();
    await page.goBack();
    await page.getByRole("button", { name: "← 閉じる" }).click();
    await expect(page).toHaveURL(detailUrl);

    // 戦法の詳細の繰り返し手順: 18 手目まで 2 局が同じ。手をタップすると盤面と対局へのボタン
    const lines = detail.locator("details.lines").first();
    await expect(lines.locator("summary")).toContainText(
      "先手で繰り返している手順 · 幹 18 手目まで 2 局",
    );
    await lines.locator("summary").click();
    await expect(lines.locator(".line-move").first()).toHaveText("▲7六歩 (2)");
    await expect(lines.locator("svg.board")).toBeHidden();
    await lines.getByRole("button", { name: "△5四歩" }).click();
    await expect(lines.locator("svg.board")).toBeVisible();
    await lines.locator(".detail-body button").first().click();
    await expect(page).toHaveURL(/#\/game\/[0-9a-f]+\/18$/);
    await page.goBack();
    // 戻ると同じ戦法の詳細で、開いていた折りたたみがそのまま
    await expect(page).toHaveURL(detailUrl);
    await expect(lines).toHaveAttribute("open", "");

    // 戦法の詳細から、その戦法の対局一覧へ
    await detail.getByRole("link", { name: /この戦法の棋譜一覧/ }).click();
    await expect(page).toHaveURL(
      /#\/games\?player=taro&shape=taikokei&selfStyle=furibisha&opening=[^&]+&openingSide=self$/,
    );
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
