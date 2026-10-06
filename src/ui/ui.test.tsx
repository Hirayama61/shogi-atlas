// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseKifu } from "../core/parse";
import {
  QUEST_KIF_TIMEOUT,
  USI_ANAGUMA_VS_SHIKEN,
  USI_SHIKEN_VS_FUNA,
  WARS_KIF,
} from "../core/__tests__/fixtures";
import { db } from "../db/db";
import type { AnalysisRecord } from "../core/analysis";
import { GameList } from "./GameList";
import { GameViewer } from "./GameViewer";
import { PlayerList } from "./PlayerList";
import { PlayerPage } from "./PlayerPage";

const source = { kind: "paste" as const };

async function seed() {
  const a = await parseKifu(WARS_KIF, { source, tags: ["Sukonbu3"] });
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
  await db.games.bulkPut([a, b, c]);
  return { a, b, c };
}

describe("UI", () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.analyses.clear();
    location.hash = "";
  });
  afterEach(cleanup);

  it("GameList: 一覧に対局と概要が出る", async () => {
    await seed();
    render(<GameList />);
    await waitFor(() => expect(screen.getByText(/3 \/ 3 局/)).toBeInTheDocument());
    expect(screen.getByText("☖nemushi_")).toBeInTheDocument();
    expect(screen.getAllByText(/四間飛車/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("undefined");
  });

  it("GameList: 出典サービスのバッジが出て、ウォーズ/クエストで絞り込める", async () => {
    await seed();
    const q = await parseKifu(QUEST_KIF_TIMEOUT, { source });
    Object.assign(q, { startedAt: "2026-04-01T00:00:00" });
    await db.games.put(q);
    render(<GameList />);
    await waitFor(() => expect(screen.getByText(/4 \/ 4 局/)).toBeInTheDocument());
    const badges = screen.getAllByLabelText("出典").map((el) => el.textContent);
    expect(badges).toEqual(["クエスト", "ウォーズ"]);

    const input = screen.getByPlaceholderText(/絞り込み/);
    fireEvent.change(input, { target: { value: "ウォーズ" } });
    await waitFor(() => expect(screen.getByText(/1 \/ 4 局/)).toBeInTheDocument());
    expect(screen.getByText("☖nemushi_")).toBeInTheDocument();
    expect(screen.queryByText("☗alice")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "クエスト" } });
    await waitFor(() => expect(screen.getByText(/1 \/ 4 局/)).toBeInTheDocument());
    expect(screen.getByText("☗alice")).toBeInTheDocument();
    expect(screen.queryByText("☖nemushi_")).not.toBeInTheDocument();

    // 既存の絞り込み (対局者) はそのまま
    fireEvent.change(input, { target: { value: "x1" } });
    await waitFor(() => expect(screen.getByText(/1 \/ 4 局/)).toBeInTheDocument());
    expect(screen.getByText("☖x1")).toBeInTheDocument();
  });

  it("GameViewer: 盤面・戦法・囲い・同じ局面の対局が出る", async () => {
    const { a, b } = await seed();
    render(<GameViewer id={b.id} initialPly={18} />);
    await waitFor(() => expect(screen.getByText(/18 手目/)).toBeInTheDocument());
    expect(screen.getByRole("img", { name: "盤面" })).toBeInTheDocument();
    expect(screen.getByText(/四間飛車 · 囲い: 本美濃/)).toBeInTheDocument();
    expect(screen.getByText(/居飛車 · 囲い: 舟囲い/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("undefined");
    // 1 手目の局面は a とも共通
    render(<GameViewer id={a.id} initialPly={1} />);
    await waitFor(() => expect(screen.getByText("同じ局面を通った対局")).toBeInTheDocument());
  });

  it("PlayerList: 登録した対局者だけを出し、切り替えで相手も出す", async () => {
    await seed();
    render(<PlayerList />);
    await waitFor(() => expect(screen.getByText("Sukonbu3")).toBeInTheDocument());
    expect(screen.queryByText("nemushi_")).not.toBeInTheDocument();
    screen.getByLabelText("対局相手も表示").click();
    await waitFor(() => expect(screen.getByText("nemushi_")).toBeInTheDocument());
  });

  it("PlayerPage: 成績と戦法の内訳が出る", async () => {
    await seed();
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(screen.getByText(/3 局 · 1 勝 2 敗/)).toBeInTheDocument());
    expect(screen.getByText("採用戦法")).toBeInTheDocument();
    expect(screen.getByText("相手の戦法別")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("undefined");
  });

  it("PlayerPage: 対局が無い人", async () => {
    render(<PlayerPage name="nobody" />);
    await waitFor(() => expect(screen.getByText(/nobody の対局がありません/)).toBeInTheDocument());
  });

  it("GameViewer: 解析があれば評価値グラフと悪手の印、解析つき KIF が出る", async () => {
    const { a } = await seed();
    const cps = [0, 10, 0, 20, 0, -400, -380, -400, 600, 580, 600, 620, 600, 610, 600];
    const analysis: AnalysisRecord = {
      schema: 1,
      id: a.id,
      engine: { name: "fake", depth: 1 },
      analyzedAt: "2026-01-01T00:00:00Z",
      plies: cps.map((cp, ply) =>
        ply === 7 ? { ply, cp, best: "7a6b", pv: ["7a6b"] } : { ply, cp },
      ),
    };
    await db.analyses.put(analysis);
    render(<GameViewer id={a.id} initialPly={8} />);
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "評価値の推移" })).toBeInTheDocument(),
    );
    expect(screen.getByText("解析つき KIF をコピー")).toBeInTheDocument();
    expect(screen.getAllByText("??").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/大悪手/).length).toBeGreaterThan(0);
    expect(screen.getByText(/-400 → \+600/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("undefined");
  });

  it("PlayerPage: 解析があれば弱点プロファイルが出る", async () => {
    const { b } = await seed();
    const cps = Array.from({ length: 21 }, (_, i) => (i >= 15 ? -900 : 0));
    await db.analyses.put({
      schema: 1,
      id: b.id,
      engine: { name: "fake", depth: 1 },
      analyzedAt: "2026-01-01T00:00:00Z",
      plies: cps.map((cp, ply) => ({ ply, cp })),
    });
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(screen.getByText(/解析済み 1 局/)).toBeInTheDocument());
    expect(screen.getByText("痛かった手")).toBeInTheDocument();
    expect(screen.getByText("局面を開く")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("undefined");
    expect(document.body.textContent).not.toContain("NaN");
  });
});
