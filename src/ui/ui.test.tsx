// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { parseHash } from "./router";

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

  it("GameList: 出典サービスのバッジが出て、文字入力の絞り込み欄は無い", async () => {
    await seed();
    const q = await parseKifu(QUEST_KIF_TIMEOUT, { source });
    Object.assign(q, { startedAt: "2026-04-01T00:00:00" });
    await db.games.put(q);
    render(<GameList />);
    await waitFor(() => expect(screen.getByText(/4 \/ 4 局/)).toBeInTheDocument());
    const badges = screen.getAllByLabelText("出典").map((el) => el.textContent);
    expect(badges).toEqual(["クエスト", "ウォーズ"]);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/絞り込み/)).not.toBeInTheDocument();
  });

  it("GameList: 絞り込み条件を渡すと、その対局者のその戦法の対局だけが出る", async () => {
    const { a, b, c } = await seed();
    // 3 局とも Sukonbu3 が先手
    const opening = b.opening.blackOpening;
    render(<GameList filter={{ player: "Sukonbu3", field: "opening", value: opening }} />);
    const expected = [a, b, c].filter((g) => g.opening.blackOpening === opening).length;
    await waitFor(() =>
      expect(screen.getByText(`${expected} / ${expected} 局`)).toBeInTheDocument(),
    );
    expect(screen.getByText(opening)).toBeInTheDocument();
    expect(c.opening.blackOpening).not.toBe(opening);
    expect(screen.queryByText("☖x2")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "← Sukonbu3" }));
    expect(location.hash).toBe("#/player/Sukonbu3");
  });

  it("PlayerList: 文字入力の絞り込み欄は無い", async () => {
    await seed();
    render(<PlayerList />);
    await waitFor(() => expect(screen.getByText("Sukonbu3")).toBeInTheDocument());
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
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

  it("PlayerPage: 戦法・囲い・相手の戦法の行から絞り込み済みの一覧へ飛ぶ", async () => {
    const { b } = await seed();
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(screen.getByText(/3 局 · 1 勝 2 敗/)).toBeInTheDocument());
    const table = (title: string) => screen.getByText(title).closest(".panel") as HTMLElement;
    const cases = [
      ["採用戦法", "opening", b.opening.blackOpening],
      ["囲い", "castle", b.opening.blackCastle],
      ["相手の戦法別", "vsOpening", b.opening.whiteOpening],
    ] as const;
    for (const [title, field, value] of cases) {
      const link = within(table(title)).getByRole("link", { name: value });
      expect(link).toHaveAttribute(
        "href",
        `#/player/Sukonbu3/games/${field}/${encodeURIComponent(value)}`,
      );
      fireEvent.click(link.closest("tr")!);
      expect(parseHash(location.hash)).toEqual({
        kind: "list",
        filter: { player: "Sukonbu3", field, value },
      });
    }
  });

  it("PlayerPage: 分岐点は戦法ごとにまとまり、1 局面 1 行で閉じている", async () => {
    const { b } = await seed();
    await db.games.put({ ...b, id: "b-copy", startedAt: "2026-04-01T00:00:00" });
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(screen.getByText(/手目まで共通 · 2 局/)).toBeInTheDocument());
    const branch = screen.getByText(/手目まで共通 · 2 局/).closest("details");
    expect(branch).not.toBeNull();
    expect(branch!.open).toBe(false);
    expect(branch!.querySelector("summary svg")).toBeNull();
    expect(branch!.querySelectorAll("button")).toHaveLength(2);
    expect(document.querySelector(".branch-group")?.textContent).toContain(b.opening.blackOpening);
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
    expect(screen.getByText("平均損失とは")).toBeInTheDocument();
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
    // 痛かった手・分岐点は初期状態で閉じている
    expect(document.querySelectorAll("details.worst").length).toBeGreaterThan(0);
    expect(document.querySelector("details.worst[open], details.branch[open]")).toBeNull();
    // 平均損失の意味と目安
    expect(screen.getByText("平均損失とは")).toBeInTheDocument();
    expect(document.body.textContent).toContain("最善手を指した場合と比べて");
    expect(document.body.textContent).toContain("120 以上で疑問手");
    expect(document.body.textContent).not.toContain("undefined");
    expect(document.body.textContent).not.toContain("NaN");
  });
});
