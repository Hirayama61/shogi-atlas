// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseKifu } from "../core/parse";
import { USI_ANAGUMA_VS_SHIKEN, USI_SHIKEN_VS_FUNA } from "../core/__tests__/fixtures";
import { db } from "../db/db";
import App from "../App";
import { hashFor, navigate, type Route } from "./router";

const source = { kind: "paste" as const };

async function seed() {
  const b = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
  const c = await parseKifu(USI_ANAGUMA_VS_SHIKEN, { source });
  Object.assign(b, {
    black: "Sukonbu3",
    white: "x1",
    result: "black",
    startedAt: "2026-02-01T00:00:00",
    tags: ["Sukonbu3"],
  });
  Object.assign(c, {
    black: "Sukonbu3",
    white: "x2",
    result: "white",
    startedAt: "2026-03-01T00:00:00",
    tags: ["Sukonbu3"],
  });
  await db.games.bulkPut([b, c]);
  return { b, c };
}

/** b, b2 (本人がノーマル四間飛車) の戦法の詳細 */
const DETAIL: Route = {
  kind: "player",
  name: "Sukonbu3",
  view: { quadrant: "furiVsIbisha", opening: "ノーマル四間飛車" },
};

function setScrollY(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
}

describe("棋譜画面から戻る", () => {
  let scrollTo: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    await db.games.clear();
    await db.analyses.clear();
    sessionStorage.clear();
    history.replaceState(null, "", "#/");
    scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    setScrollY(0);
  });
  afterEach(cleanup);

  it("URL を直接開いたときは本人の対局者ページへ戻る", async () => {
    const { b } = await seed();
    history.replaceState(null, "", `#/game/${b.id}`);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "← 戻る" }));
    await waitFor(() => expect(location.hash).toBe("#/player/Sukonbu3"));
  });

  it("戦法の詳細から棋譜を開いて戻ると、同じ区分・戦法が開いた状態で同じ折りたたみ・スクロール位置になる", async () => {
    const { b } = await seed();
    const b2 = await parseKifu(USI_SHIKEN_VS_FUNA.replace("1g1f 1c1d", "9g9f 9c9d"), { source });
    Object.assign(b2, { black: "Sukonbu3", white: "x3", result: "white", tags: ["Sukonbu3"] });
    await db.games.put(b2);
    history.replaceState(null, "", hashFor(DETAIL));
    render(<App />);
    const lines = () =>
      waitFor(() => {
        const d = document.querySelector<HTMLDetailsElement>(".opening-detail details.lines");
        expect(d).not.toBeNull();
        return d!;
      });
    (await lines()).open = true;
    setScrollY(640);

    // 対局者ページの「局面を開く」などと同じアプリ内の遷移で棋譜を開く
    act(() => navigate({ kind: "game", id: b.id }));
    await waitFor(() => expect(location.hash).toBe(`#/game/${b.id}`));
    setScrollY(0);
    fireEvent.click(await screen.findByRole("button", { name: "← 戻る" }));

    await waitFor(() => expect(location.hash).toBe(hashFor(DETAIL)));
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 640));
    expect((await lines()).open).toBe(true);
    expect(document.querySelector(".opening-detail strong")).toHaveTextContent("ノーマル四間飛車");
  });

  it("分岐点の学習画面を閉じると戦法の詳細の同じ折りたたみ・スクロール位置に戻る", async () => {
    await seed();
    const b2 = await parseKifu(USI_SHIKEN_VS_FUNA.replace("1g1f 1c1d", "9g9f 9c9d"), { source });
    Object.assign(b2, { black: "Sukonbu3", white: "x3", result: "white", tags: ["Sukonbu3"] });
    await db.games.put(b2);
    history.replaceState(null, "", hashFor(DETAIL));
    render(<App />);
    const row = await waitFor(() => {
      const a = document.querySelector<HTMLAnchorElement>(".opening-detail a.branch-row");
      expect(a).not.toBeNull();
      return a!;
    });
    const lines = () => document.querySelector<HTMLDetailsElement>("details.lines")!;
    lines().open = true;
    setScrollY(900);
    act(() => {
      location.hash = row.getAttribute("href")!;
    });
    await screen.findByRole("group", { name: "本人の候補手" });
    setScrollY(0);
    fireEvent.click(screen.getByRole("button", { name: "← 閉じる" }));

    await waitFor(() => expect(location.hash).toBe(hashFor(DETAIL)));
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 900));
    await waitFor(() => expect(lines().open).toBe(true));
  });

  it("分岐点の学習画面から棋譜へ飛んで戻ると、手数・選んだ候補・続きの対局が保たれる", async () => {
    await seed();
    const variant = async (id: string, to: string, white: string) => {
      const g = await parseKifu(USI_SHIKEN_VS_FUNA.replace("1g1f 1c1d", to), { source });
      Object.assign(g, { id, black: "Sukonbu3", white, result: "white", tags: ["Sukonbu3"] });
      return g;
    };
    const b2 = await variant("b2b2b2", "9g9f 9c9d", "x3");
    const b4 = await variant("b4b4b4", "9g9f 1c1d", "x4");
    await db.games.bulkPut([b2, b4]);
    history.replaceState(null, "", hashFor(DETAIL));
    render(<App />);
    const row = await waitFor(() => {
      const a = Array.from(
        document.querySelectorAll<HTMLAnchorElement>(".opening-detail a.branch-row"),
      ).find((x) => x.textContent?.includes("18 手目"));
      expect(a).toBeDefined();
      return a!;
    });
    act(() => {
      location.hash = row.getAttribute("href")!;
    });
    const group = await screen.findByRole("group", { name: "本人の候補手" });
    // ▲9六歩 (b2, b4) を選び、続きの対局を b4 にして 1 手進める
    fireEvent.click(within(group).getByRole("button", { name: /^▲9六歩/ }));
    const lines = () => document.querySelector(".study-lines") as HTMLElement;
    await waitFor(() => expect(lines()).not.toBeNull());
    fireEvent.click(within(lines()).getByRole("button", { name: /vs x4/ }));
    fireEvent.click(screen.getByRole("button", { name: "進む" }));
    const ply = () => document.querySelector(".study-ply")!.textContent;
    await waitFor(() => expect(ply()).toBe("20 手目 △1四歩"));
    fireEvent.click(screen.getByRole("button", { name: /^棋譜で開く/ }));
    await waitFor(() => expect(location.hash).toBe(`#/game/${b4.id}/20`));
    fireEvent.click(await screen.findByRole("button", { name: "← 戻る" }));

    await waitFor(() =>
      expect(document.querySelector(".study-ply")?.textContent).toBe("20 手目 △1四歩"),
    );
    const restored = screen.getByRole("group", { name: "本人の候補手" });
    expect(within(restored).getByRole("button", { name: /^▲9六歩/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(lines()).getByRole("button", { name: /vs x4/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // 閉じると戦法の詳細へ戻る
    fireEvent.click(screen.getByRole("button", { name: "← 閉じる" }));
    await waitFor(() => expect(location.hash).toBe(hashFor(DETAIL)));
  });

  it("区分 → 戦法の詳細と開き、一つ上に戻ると前の位置に戻る", async () => {
    await seed();
    history.replaceState(null, "", "#/player/Sukonbu3");
    render(<App />);
    const card = await screen.findByRole("link", { name: /対抗形 · 自分が振り飛車/ });
    setScrollY(300);
    act(() => {
      location.hash = card.getAttribute("href")!;
    });
    const list = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".opening-list");
      if (!el) throw new Error("opening-list not rendered");
      return el;
    });
    const row = within(list).getByRole("link", { name: "ノーマル四間飛車" });
    setScrollY(500);
    act(() => {
      location.hash = row.getAttribute("href")!;
    });
    await waitFor(() => expect(location.hash).toBe(hashFor(DETAIL)));
    setScrollY(0);
    fireEvent.click(await screen.findByRole("link", { name: /← 対抗形 · 自分が振り飛車 の戦法/ }));
    await waitFor(() =>
      expect(location.hash).toBe(
        hashFor({ kind: "player", name: "Sukonbu3", view: { quadrant: "furiVsIbisha" } }),
      ),
    );
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 500));
    expect(document.querySelector(".opening-detail")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "← 戦型" }));
    await waitFor(() => expect(location.hash).toBe("#/player/Sukonbu3"));
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 300));
  });

  it("絞り込んだ一覧から開いたときは同じ条件の一覧へ戻る", async () => {
    const { c } = await seed();
    const listHash = "#/games?player=Sukonbu3&result=loss";
    history.replaceState(null, "", listHash);
    render(<App />);
    await screen.findByText("1 / 2 局");
    setScrollY(120);
    fireEvent.click(screen.getByText("☖x2"));
    await waitFor(() => expect(location.hash).toBe(`#/game/${c.id}`));
    fireEvent.click(await screen.findByRole("button", { name: "← 戻る" }));
    await waitFor(() => expect(location.hash).toBe(listHash));
    await screen.findByText("1 / 2 局");
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 120));
  });
});
