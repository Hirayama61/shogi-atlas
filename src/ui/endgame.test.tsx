// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisRecord } from "../core/analysis";
import { USI_ENDGAME_A, USI_ENDGAME_B, USI_ENDGAME_C } from "../core/__tests__/fixtures";
import { parseKifu } from "../core/parse";
import type { GameRecord } from "../core/types";
import { db } from "../db/db";
import App from "../App";

const source = { kind: "paste" as const };

function analysis(id: string, plies: Array<{ cp: number; best?: string; pv?: string[] }>) {
  return {
    schema: 1,
    id,
    engine: { name: "fake", depth: 1 },
    analyzedAt: "2026-01-01T00:00:00Z",
    plies: plies.map((p, ply) => ({ ply, ...p })),
  } satisfies AnalysisRecord;
}

async function game(
  usi: string,
  black: string,
  white: string,
  castle: Partial<GameRecord["opening"]>,
): Promise<GameRecord> {
  const g = await parseKifu(usi, { source });
  Object.assign(g, { black, white, startedAt: "2026-03-01T10:00:00" });
  Object.assign(g.opening, { blackCastle: "不明", whiteCastle: "不明", ...castle });
  return g;
}

/**
 * 美濃囲い (☖玉 2二) を ▲2一飛 で崩す 3 局 (自分は 1 局で逃した) と、△同銀 で受けた 1 問。
 * 矢倉囲いの対局は形が同じでも別の囲いの問題群になる。
 */
async function seed({ analyzed = true } = {}) {
  const a = await game(USI_ENDGAME_A, "taro", "jiro", { whiteCastle: "美濃囲い" });
  const b = await game(USI_ENDGAME_B, "自分", "saburo", { whiteCastle: "美濃囲い" });
  const c = await game(USI_ENDGAME_C, "shiro", "goro", { blackCastle: "美濃囲い" });
  const d = await game(USI_ENDGAME_B, "rokuro", "nanao", { whiteCastle: "矢倉囲い" });
  d.id = "dddd0000dddd0000";
  await db.games.bulkPut([a, b, c, d]);
  if (analyzed)
    await db.analyses.bulkPut([
      analysis(a.id, [
        { cp: 500, best: "R*2a", pv: ["R*2a", "3b2a"] },
        { cp: 500, best: "3b2a" },
        { cp: 500 },
      ]),
      analysis(b.id, [{ cp: 500, best: "R*2a", pv: ["R*2a", "3b2a", "9i9h"] }, { cp: -200 }]),
      analysis(c.id, [{ cp: -500, best: "R*8i" }, { cp: 200 }]),
      analysis(d.id, [{ cp: 500, best: "R*2a" }, { cp: -200 }]),
    ]);
  return { a, b, c, d };
}

function open(hash: string) {
  history.replaceState(null, "", hash);
  render(<App />);
}

function groupButtons() {
  return within(screen.getByRole("list", { name: "問題群" })).getAllByRole("button");
}

describe("終盤力強化", () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.analyses.clear();
    localStorage.clear();
    sessionStorage.clear();
    history.replaceState(null, "", "#/");
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });
  afterEach(cleanup);

  it("解析済みの対局が無いと案内を出す", async () => {
    await seed({ analyzed: false });
    open("#/");
    fireEvent.click(await screen.findByRole("button", { name: "終盤" }));
    expect(await screen.findByText(/問題にできる局面がありません/)).toBeTruthy();
    expect(location.hash).toBe("#/endgame");
  });

  it("囲いで絞り、問題群を選んで出題 → 答え → 記録 → 次へ が通る", async () => {
    const { b } = await seed();
    open("#/endgame");
    await screen.findByRole("list", { name: "問題群" });
    // 自分が逃した群が先頭
    expect(groupButtons().map((x) => x.textContent)).toEqual([
      expect.stringMatching(/^崩し方 · 美濃囲い 3 問 · 3 局 · .*自分が 1 回 崩す手を逃した形$/),
      expect.stringMatching(/^崩し方 · 矢倉囲い 1 問/),
      expect.stringMatching(/^崩され方 · 美濃囲い 1 問/),
    ]);
    const select = screen.getByRole("combobox", { name: "囲い" });
    expect(Array.from(select.querySelectorAll("option")).map((o) => o.textContent)).toEqual([
      "すべて",
      "美濃囲い (4)",
      "矢倉囲い (1)",
    ]);
    fireEvent.change(select, { target: { value: "矢倉囲い" } });
    await waitFor(() => expect(groupButtons()).toHaveLength(1));
    fireEvent.change(select, { target: { value: "美濃囲い" } });
    await waitFor(() => expect(groupButtons()).toHaveLength(2));
    fireEvent.click(groupButtons()[0]!);

    // 最初は自分が逃した問題 (B)。候補手は 4 つ、本人 (先手) 側が手前
    expect(await screen.findByText(/相手 \(saburo\) の囲いを崩す手は/)).toBeTruthy();
    const choices = within(screen.getByRole("group", { name: "候補手" })).getAllByRole("button");
    expect(choices).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "▲2一飛" }));
    const answer = await screen.findByRole("status");
    expect(answer.textContent).toContain("正解");
    expect(answer.textContent).toContain("最善手▲2一飛");
    expect(answer.textContent).toContain("読み筋▲2一飛 △同　銀 ▲9八玉");
    expect(answer.textContent).toContain("実戦の手▲8八玉 (損失 700 · 大悪手)");
    expect(location.hash).toContain(`problem=${b.id}%3A1`);

    // 次は未出題の問題
    fireEvent.click(screen.getByRole("button", { name: "次の問題" }));
    await waitFor(() => expect(location.hash).not.toContain(`problem=${b.id}`));
    expect(screen.queryByRole("status")).toBeNull();
    const records = JSON.parse(localStorage.getItem("shogi-atlas:endgame-records") ?? "{}");
    expect(records).toEqual({ [`${b.id}:1`]: { attempts: 1, correct: true } });
  });

  it("答えから棋譜のその手数へ飛び、戻ると同じ問題が開く", async () => {
    const { b } = await seed();
    open("#/endgame");
    await screen.findByRole("list", { name: "問題群" });
    fireEvent.click(groupButtons()[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "▲8八玉" }));
    expect((await screen.findByRole("status")).textContent).toContain("不正解");
    fireEvent.click(screen.getByRole("button", { name: /棋譜で開く/ }));
    await waitFor(() => expect(location.hash).toBe(`#/game/${b.id}/0`));
    cleanup();
    // 戻った URL (問題つき) で開き直す
    open(
      `#/endgame?group=${encodeURIComponent(`attack|美濃囲い|88:P,P,P,.,K,S,.,.,.`)}&problem=${b.id}%3A1`,
    );
    expect(await screen.findByText(/相手 \(saburo\) の囲いを崩す手は/)).toBeTruthy();
  });

  it("記録は再読み込み後も残り、未出題 → 不正解 → 正解の順に出す", async () => {
    await seed();
    const group = `#/endgame?group=${encodeURIComponent("attack|美濃囲い|88:P,P,P,.,K,S,.,.,.")}`;
    open(group);
    // B (自分) を不正解、次の問題も答える
    fireEvent.click(await screen.findByRole("button", { name: "▲8八玉" }));
    fireEvent.click(screen.getByRole("button", { name: "次の問題" }));
    const second = await screen.findByText(/の囲いを崩す手は/);
    // 問題文は相手 (A なら jiro、C なら shiro) を出す
    const secondIsA = second.textContent!.includes("jiro");
    fireEvent.click(screen.getByRole("button", { name: secondIsA ? "▲2一飛" : "△8九飛" }));
    await screen.findByRole("status");
    cleanup();

    // 再読み込み: 残った未出題が先、その次が不正解の B、正解は最後
    open(group);
    const third = await screen.findByText(/の囲いを崩す手は/);
    expect(third.textContent).toContain(secondIsA ? "shiro" : "jiro");
    const choices = within(screen.getByRole("group", { name: "候補手" })).getAllByRole("button");
    fireEvent.click(choices[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "次の問題" }));
    expect(await screen.findByText(/相手 \(saburo\) の囲いを崩す手は/)).toBeTruthy();
    // 一覧には不正解の数が出る
    fireEvent.click(screen.getByRole("button", { name: "← 問題群の一覧" }));
    await screen.findByRole("list", { name: "問題群" });
    expect(groupButtons()[0]!.textContent).toMatch(/未出題 0 · 不正解 [12]/);
  });
});
