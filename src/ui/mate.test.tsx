// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisRecord, PlyEval } from "../core/analysis";
import { USI_TSUMERO_A, USI_TSUMERO_B } from "../core/__tests__/fixtures";
import { parseKifu } from "../core/parse";
import type { GameRecord } from "../core/types";
import { db } from "../db/db";
import App from "../App";
import { MoveBoard } from "./MoveBoard";

const source = { kind: "paste" as const };

function analysis(id: string, plies: Array<Omit<PlyEval, "ply">>): AnalysisRecord {
  return {
    schema: 1,
    id,
    engine: { name: "fake", depth: 1 },
    analyzedAt: "2026-01-01T00:00:00Z",
    plies: plies.map((p, ply) => ({ ply, ...p })),
  };
}

async function game(usi: string, black: string, white: string): Promise<GameRecord> {
  const g = await parseKifu(usi, { source });
  Object.assign(g, { black, white, startedAt: "2026-03-01T10:00:00" });
  Object.assign(g.opening, { blackCastle: "不明", whiteCastle: "穴熊" });
  return g;
}

/** ▲2三歩 の詰めろから 1 手詰の 2 局。自分の対局 (B) は詰みを逃した */
async function seed() {
  const a = await game(USI_TSUMERO_A, "taro", "jiro");
  const b = await game(USI_TSUMERO_B, "自分", "saburo");
  await db.games.bulkPut([a, b]);
  const plies = (last: Omit<PlyEval, "ply">) => [
    { cp: 800, best: "2d2c" },
    { cp: 3000, mate: -3 },
    { cp: 3000, mate: 1, best: "G*2b" },
    last,
  ];
  await db.analyses.bulkPut([
    analysis(a.id, plies({ cp: 3000 })),
    analysis(b.id, plies({ cp: 300 })),
  ]);
  return { a, b };
}

function open(hash: string) {
  history.replaceState(null, "", hash);
  render(<App />);
}

const square = (name: string) => screen.getByRole("button", { name });

describe("盤の手の入力", () => {
  afterEach(cleanup);

  it("合法手だけ受け付け、成れる手は成る / 成らないを選べる", () => {
    const onMove = vi.fn();
    render(<MoveBoard sfen="8k/8p/9/7P1/9/9/9/9/K8 b G 1" onMove={onMove} />);
    // 空きマスや相手の駒は選べない
    fireEvent.click(square("5五"));
    fireEvent.click(square("1二"));
    // 歩は 2 マス進めない
    fireEvent.click(square("2四"));
    fireEvent.click(square("2二"));
    expect(onMove).not.toHaveBeenCalled();
    // 2 三 は成れる
    fireEvent.click(square("2四"));
    fireEvent.click(square("2三"));
    const choice = screen.getByRole("group", { name: "成りの選択" });
    fireEvent.click(within(choice).getByRole("button", { name: "成る" }));
    expect(onMove).toHaveBeenLastCalledWith("2d2c+");
    fireEvent.click(square("2四"));
    fireEvent.click(square("2三"));
    fireEvent.click(screen.getByRole("button", { name: "成らない" }));
    expect(onMove).toHaveBeenLastCalledWith("2d2c");
    // 持ち駒を打つ。玉の移動は成りの選択が出ない
    fireEvent.click(screen.getByRole("button", { name: "持ち駒の金" }));
    fireEvent.click(square("5五"));
    expect(onMove).toHaveBeenLastCalledWith("G*5e");
    fireEvent.click(square("9九"));
    fireEvent.click(square("9八"));
    expect(onMove).toHaveBeenLastCalledWith("9i9h");
    expect(onMove).toHaveBeenCalledTimes(4);
  });

  it("disabled なら入力しない", () => {
    const onMove = vi.fn();
    render(<MoveBoard sfen="8k/8p/9/7P1/9/9/9/9/K8 b G 1" onMove={onMove} disabled />);
    fireEvent.click(square("9九"));
    fireEvent.click(square("9八"));
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "持ち駒の金" })).toBeNull();
  });
});

describe("詰めろと詰み", () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.analyses.clear();
    localStorage.clear();
    sessionStorage.clear();
    history.replaceState(null, "", "#/");
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });
  afterEach(cleanup);

  it("絞り込み → 詰めろ → 相手の手 → 詰将棋 → 正解 → 記録 が通る", async () => {
    const { a, b } = await seed();
    open("#/endgame");
    fireEvent.click(await screen.findByRole("button", { name: "詰めろと詰み" }));
    const list = await screen.findByRole("list", { name: "詰めろの問題" });
    // 自分が逃した問題が先頭
    expect(
      within(list)
        .getAllByRole("button")
        .map((x) => x.textContent),
    ).toEqual([
      expect.stringMatching(
        /^先手番 · 1 手詰 自分 vs saburo · 1 手目 · 1 手詰 · 穴熊自分が実戦で詰みを逃した$/,
      ),
      expect.stringMatching(/^先手番 · 1 手詰 taro vs jiro/),
    ]);
    const lengths = screen.getByRole("combobox", { name: "詰みの手数" });
    expect(Array.from(lengths.querySelectorAll("option")).map((o) => o.textContent)).toEqual([
      "すべて",
      "1 手詰 (2)",
    ]);
    fireEvent.change(lengths, { target: { value: "1" } });
    await waitFor(() => expect(location.hash).toContain("mate=1"));
    fireEvent.click(screen.getByRole("button", { name: "出題する" }));

    expect(
      await screen.findByText(/詰めろをかける手を盤で指してください \(相手: saburo\)/),
    ).toBeTruthy();
    expect(location.hash).toContain(`problem=mate%3A${b.id}%3A1`);
    fireEvent.click(square("2四"));
    fireEvent.click(square("2三"));
    fireEvent.click(screen.getByRole("button", { name: "成らない" }));
    // 実戦と同じ詰めろなので、相手は実戦の △1三歩
    expect(
      await screen.findByText(/詰めろです。相手は △1三歩。ここから詰ませてください/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "持ち駒の金" }));
    fireEvent.click(square("2二"));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("正解");
    expect(status.textContent).toContain("詰みました");
    expect(status.textContent).toContain("正解の手順▲2三歩不成 △1三歩 ▲2二金");
    const records = JSON.parse(localStorage.getItem("shogi-atlas:endgame-records") ?? "{}");
    expect(records).toEqual({ [`mate:${b.id}:1`]: { attempts: 1, correct: true } });

    // 次は未出題の A
    fireEvent.click(screen.getByRole("button", { name: "次の問題" }));
    expect(await screen.findByText(/\(相手: jiro\)/)).toBeTruthy();
    expect(location.hash).toContain(`problem=mate%3A${a.id}%3A1`);
  });

  it("詰めろでない手は不正解で、正解の手順が見え、棋譜のその手数へ飛べる", async () => {
    const { b } = await seed();
    open(`#/endgame?mode=mate&problem=mate%3A${b.id}%3A1`);
    await screen.findByText(/詰めろをかける手を盤で指してください/);
    fireEvent.click(square("9九"));
    fireEvent.click(square("9八"));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("不正解");
    expect(status.textContent).toContain("詰めろになっていません");
    expect(status.textContent).toContain("正解の手順▲2三歩不成 △1三歩 ▲2二金");
    expect(status.textContent).toContain("実戦▲2三歩不成 △1三歩 (この後、詰みを逃した)");
    const records = JSON.parse(localStorage.getItem("shogi-atlas:endgame-records") ?? "{}");
    expect(records).toEqual({ [`mate:${b.id}:1`]: { attempts: 1, correct: false } });
    fireEvent.click(screen.getByRole("button", { name: /棋譜で開く/ }));
    await waitFor(() => expect(location.hash).toBe(`#/game/${b.id}/0`));
  });

  it("詰将棋の途中で王手でない手を指すと不正解", async () => {
    const { a } = await seed();
    open(`#/endgame?mode=mate&problem=mate%3A${a.id}%3A1`);
    await screen.findByText(/詰めろをかける手を盤で指してください/);
    fireEvent.click(square("2四"));
    fireEvent.click(square("2三"));
    fireEvent.click(screen.getByRole("button", { name: "成る" }));
    await screen.findByText(/ここから詰ませてください/);
    fireEvent.click(square("9九"));
    fireEvent.click(square("9八"));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("不正解");
    expect(status.textContent).toContain("王手ではありません");
  });
});
