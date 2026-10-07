import { describe, expect, it } from "vitest";
import type { AnalysisRecord } from "../analysis";
import { branchCandidates, buildBranchStudy } from "../branchStudy";
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

function study(gs: GameRecord[], analyses: AnalysisRecord[] = [], continuation?: number) {
  const [p] = findCommonPositions(gs, "taro");
  const map = new Map(analyses.map((x) => [x.id, x] as const));
  return buildBranchStudy(p!, gs, map, "taro", continuation);
}

describe("branchStudy", () => {
  it("開始局面から分岐点までの共通手順と、本人の候補手とその先の手順の木を作る", async () => {
    const { a, b } = await games();
    const bad = flat.map((cp, ply) => (ply >= 19 ? -400 : cp));
    const s = study([a, b], [fakeAnalysis(a.id, flat), fakeAnalysis(b.id, bad, { 18: "1g1f" })])!;
    expect(s).toMatchObject({ turn: "black", side: "black", mover: "self", pathGameId: a.id });
    expect(s.start).toBe(`${a.positions[0]} 1`);
    // 共通手順は 18 手。各手の局面は対局の局面と一致し、最後が分岐点
    expect(s.path).toHaveLength(18);
    expect(s.path[0]).toMatchObject({ ply: 1, usi: "7g7f", label: "▲7六歩" });
    expect(s.path.map((st) => st.sfen.split(" ").slice(0, 3).join(" "))).toEqual(
      a.positions.slice(1, 19),
    );
    expect(s.path[17]!.sfen.split(" ").slice(0, 3).join(" ")).toBe(s.key);
    // 候補手は 2 つ。判定・損失・最善手つき
    expect(
      s.candidates.map((c) => [c.label, c.count, c.judgement, c.loss, c.bestLabel ?? null]),
    ).toEqual([
      ["▲1六歩", 1, "good", 0, null],
      ["▲9六歩", 1, "mistake", 400, "▲1六歩"],
    ]);
    // 候補手の先は、その手を指した対局の手順 (候補手を含む)
    expect(s.candidates.map((c) => c.lines.map((l) => l.gameId))).toEqual([[a.id], [b.id]]);
    expect(s.candidates[1]!.lines[0]!.steps.map((st) => [st.ply, st.label])).toEqual([
      [19, "▲9六歩"],
      [20, "△9四歩"],
    ]);
  });

  it("候補手の先は continuation 手で止め、同じ手を指した対局はそれぞれ続きを持つ", async () => {
    const { a, b } = await games();
    const e = { ...a, id: "e" };
    const s = study([a, b, e], [], 0)!;
    const top = s.candidates[0]!;
    expect(top).toMatchObject({ label: "▲1六歩", count: 2, judgement: null, loss: null });
    expect(top.lines.map((l) => [l.gameId, l.steps.length])).toEqual([
      [a.id, 1],
      ["e", 1],
    ]);
  });

  it("相手の手番の分岐点では相手の候補手が並ぶ", async () => {
    const { a, c } = await games();
    const s = study([a, c], [fakeAnalysis(a.id, flat), fakeAnalysis(c.id, flat)])!;
    expect(s).toMatchObject({ turn: "white", side: "black", mover: "opponent" });
    expect(s.path).toHaveLength(19);
    expect(s.candidates.map((c) => [c.label, c.judgement])).toEqual([
      ["△1四歩", "good"],
      ["△9四歩", "good"],
    ]);
  });

  it("一覧用に分岐点ごとの候補手をまとめて出す", async () => {
    const { a, b, c } = await games();
    const gs = [a, b, c];
    const positions = findCommonPositions(gs, "taro");
    const map = branchCandidates(positions, gs, new Map(), "taro");
    expect(map.size).toBe(positions.length);
    const at18 = positions.find((p) => p.ply === 18)!;
    expect(map.get(at18.key)!.candidates.map((c) => c.label)).toEqual(["▲1六歩", "▲9六歩"]);
  });
});
