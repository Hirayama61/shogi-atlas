import { describe, expect, it } from "vitest";
import type { AnalysisRecord } from "../analysis";
import {
  describeBranchMove,
  formatUsiMove,
  groupBranchReviews,
  reviewBranches,
  type BranchReview,
} from "../branches";
import { parseKifu } from "../parse";
import { findCommonPositions } from "../stats";
import type { GameRecord } from "../types";
import { USI_SHIKEN_VS_FUNA } from "./fixtures";

const source = { kind: "paste" as const };

function fakeAnalysis(
  id: string,
  cps: number[],
  best: Record<number, string> = {},
): AnalysisRecord {
  return {
    schema: 1,
    id,
    engine: { name: "fake", depth: 1 },
    analyzedAt: "2026-01-01T00:00:00Z",
    plies: cps.map((cp, ply) => (best[ply] ? { ply, cp, best: best[ply] } : { ply, cp })),
  };
}

/** 20 手。flat は全手 0 cp (すべて最善) */
const flat = Array.from({ length: 21 }, () => 0);

async function games() {
  // a / b: 19 手目 (本人 = 先手の手番) で分かれる。a / c: 20 手目 (相手の手番) で分かれる
  const a = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
  const b = await parseKifu(USI_SHIKEN_VS_FUNA.replace("1g1f 1c1d", "9g9f 9c9d"), { source });
  const c = await parseKifu(USI_SHIKEN_VS_FUNA.replace("1g1f 1c1d", "1g1f 9c9d"), { source });
  for (const [g, white] of [
    [a, "jiro"],
    [b, "saburo"],
    [c, "shiro"],
  ] as const)
    Object.assign(g, { black: "taro", white, result: "black" });
  return { a, b, c };
}

function review(gs: GameRecord[], analyses: AnalysisRecord[]) {
  const positions = findCommonPositions(gs, "taro");
  return reviewBranches(positions, gs, new Map(analyses.map((x) => [x.id, x] as const)), "taro");
}

describe("branches", () => {
  it("USI の手を日本語表記にする", () => {
    const start = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b -";
    expect(formatUsiMove(start, "7g7f")).toBe("▲7六歩");
    expect(formatUsiMove(start, "7c7d")).toBe("7c7d");
  });

  it("本人の手番: 手ごとに回数・判定・最善手を出し、最善以外があれば悪手を指した分岐", async () => {
    const { a, b } = await games();
    const bad = flat.map((cp, ply) => (ply >= 19 ? -400 : cp));
    const [r] = review([a, b], [fakeAnalysis(a.id, flat), fakeAnalysis(b.id, bad, { 18: "1g1f" })]);
    expect(r).toMatchObject({
      ply: 18,
      turn: "black",
      kind: "mistake",
      opening: "ノーマル四間飛車",
    });
    expect(r!.moves.map((m) => [m.label, m.count, m.judgement, m.bestLabel])).toEqual([
      ["▲1六歩", 1, "good", undefined],
      ["▲9六歩", 1, "mistake", "▲1六歩"],
    ]);
    expect(r!.moves.map(describeBranchMove)).toEqual([
      "▲1六歩 ×1 (最善)",
      "▲9六歩 ×1 (悪手, 最善 ▲1六歩)",
    ]);
  });

  it("疑問手も悪手を指した分岐に入れ、すべて最善なら正しく指せた分岐", async () => {
    const { a, b } = await games();
    const slight = flat.map((cp, ply) => (ply >= 19 ? -150 : cp));
    const [r1] = review([a, b], [fakeAnalysis(a.id, flat), fakeAnalysis(b.id, slight)]);
    expect(r1!.kind).toBe("mistake");
    expect(r1!.moves[1]!.judgement).toBe("inaccuracy");
    const [r2] = review([a, b], [fakeAnalysis(a.id, flat), fakeAnalysis(b.id, flat)]);
    expect(r2!.kind).toBe("correct");
  });

  it("相手の手番なら相手の選択で分かれた分岐 (本人の手は無い)", async () => {
    const { a, c } = await games();
    const [r] = review([a, c], [fakeAnalysis(a.id, flat), fakeAnalysis(c.id, flat)]);
    expect(r).toMatchObject({ ply: 19, turn: "white", kind: "opponent", moves: [] });
  });

  it("解析済みの対局が通っていなければ未解析。解析が古ければ無いものとして扱う", async () => {
    const { a, b, c } = await games();
    const [r1] = review([a, b], []);
    expect(r1!.kind).toBe("unanalyzed");
    expect(r1!.moves.map(describeBranchMove)).toEqual(["▲1六歩 ×1 (未解析)", "▲9六歩 ×1 (未解析)"]);
    const [r2] = review([a, c], [fakeAnalysis(a.id, flat.slice(0, 10))]);
    expect(r2!.kind).toBe("unanalyzed");
    // 片方だけ解析済みなら、解析済みの手で判定する
    const [r3] = review([a, b], [fakeAnalysis(a.id, flat)]);
    expect(r3!.kind).toBe("correct");
    expect(r3!.moves.map((m) => m.judgement)).toEqual(["good", null]);
  });

  it("戦法は局数の多い方に寄せ、戦法 × 分類でまとめる", async () => {
    const { a, b } = await games();
    const d = { ...b, id: "d", opening: { ...b.opening, blackOpening: "三間飛車" } };
    const e = { ...a, id: "e" };
    const reviews = review([a, b, d, e], [fakeAnalysis(a.id, flat), fakeAnalysis(e.id, flat)]);
    // 4 局が通る 18 手目の分岐点は ノーマル四間飛車 3 局 / 三間飛車 1 局 → ノーマル四間飛車
    const at18 = reviews.find((r) => r.gameIds.length === 4)!;
    expect(at18.opening).toBe("ノーマル四間飛車");

    const mk = (opening: string, kind: BranchReview["kind"], key: string): BranchReview => ({
      key,
      ply: 10,
      gameIds: ["x", "y"],
      wins: 0,
      turn: "black",
      opening,
      kind,
      moves: [],
    });
    const groups = groupBranchReviews([
      mk("中飛車", "correct", "1"),
      mk("四間飛車", "unanalyzed", "2"),
      mk("四間飛車", "correct", "3"),
      mk("四間飛車", "mistake", "4"),
      mk("四間飛車", "mistake", "5"),
    ]);
    expect(
      groups.map((g) => [
        g.opening,
        g.total,
        g.kinds.map((k) => [k.kind, k.positions.map((p) => p.key)]),
      ]),
    ).toEqual([
      [
        "四間飛車",
        4,
        [
          ["mistake", ["4", "5"]],
          ["correct", ["3"]],
          ["unanalyzed", ["2"]],
        ],
      ],
      ["中飛車", 1, [["correct", ["1"]]]],
    ]);
  });
});
