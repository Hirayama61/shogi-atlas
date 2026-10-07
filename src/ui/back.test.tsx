// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseKifu } from "../core/parse";
import { USI_ANAGUMA_VS_SHIKEN, USI_SHIKEN_VS_FUNA } from "../core/__tests__/fixtures";
import { db } from "../db/db";
import App from "../App";
import { navigate } from "./router";

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

  it("対局者ページから開いたときは戻ると同じ折りたたみ・スクロール位置になる", async () => {
    const { b } = await seed();
    history.replaceState(null, "", "#/player/Sukonbu3");
    render(<App />);
    await screen.findByText("戦型ポートフォリオ");
    const portfolio = () => document.querySelector<HTMLDetailsElement>("details.portfolio")!;
    portfolio().open = true;
    setScrollY(640);

    // 対局者ページの「局面を開く」などと同じアプリ内の遷移で棋譜を開く
    act(() => navigate({ kind: "game", id: b.id }));
    await waitFor(() => expect(location.hash).toBe(`#/game/${b.id}`));
    setScrollY(0);
    fireEvent.click(await screen.findByRole("button", { name: "← 戻る" }));

    await waitFor(() => expect(location.hash).toBe("#/player/Sukonbu3"));
    await screen.findByText("戦型ポートフォリオ");
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 640));
    expect(portfolio().open).toBe(true);
  });

  it("分岐点の学習画面を閉じると対局者ページの同じ折りたたみ・スクロール位置に戻る", async () => {
    await seed();
    const b2 = await parseKifu(USI_SHIKEN_VS_FUNA.replace("1g1f 1c1d", "9g9f 9c9d"), { source });
    Object.assign(b2, { black: "Sukonbu3", white: "x3", result: "white", tags: ["Sukonbu3"] });
    await db.games.put(b2);
    history.replaceState(null, "", "#/player/Sukonbu3");
    render(<App />);
    await screen.findByText("戦型ポートフォリオ");
    const portfolio = () => document.querySelector<HTMLDetailsElement>("details.portfolio")!;
    portfolio().open = true;
    setScrollY(900);

    const row = await waitFor(() => {
      const a = document.querySelector<HTMLAnchorElement>("a.branch-row");
      expect(a).not.toBeNull();
      return a!;
    });
    act(() => {
      location.hash = row.getAttribute("href")!;
    });
    await screen.findByRole("group", { name: "本人の候補手" });
    setScrollY(0);
    fireEvent.click(screen.getByRole("button", { name: "← 閉じる" }));

    await waitFor(() => expect(location.hash).toBe("#/player/Sukonbu3"));
    await screen.findByText("戦型ポートフォリオ");
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 900));
    expect(portfolio().open).toBe(true);
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
