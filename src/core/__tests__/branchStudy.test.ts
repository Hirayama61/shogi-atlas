import { describe, expect, it } from "vitest";
import type { AnalysisRecord } from "../analysis";
import { buildBranchStudy, buildBranchTrees, flattenBranchTree } from "../branchStudy";
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

  it("戦法の対局から分岐点を節に持つ木を作る。下流の分岐点は親の候補手の先に付く", async () => {
    const { a, b, c } = await games();
    const bad = flat.map((cp, ply) => (ply >= 19 ? -400 : cp));
    const map = new Map(
      [fakeAnalysis(a.id, flat), fakeAnalysis(b.id, bad, { 18: "1g1f" })].map(
        (x) => [x.id, x] as const,
      ),
    );
    const trees = buildBranchTrees([a, b, c], map, "taro");
    expect(trees.map((t) => [t.side, t.size, t.roots.length])).toEqual([["black", 2, 1]]);
    const root = trees[0]!.roots[0]!;
    // 18 手目で本人が分かれ (悪手あり)、▲1六歩 の先の 19 手目で相手が分かれる
    expect(root).toMatchObject({ ply: 18, kind: "mistake", mover: "self", key: a.positions[18] });
    expect(root.gameIds).toEqual([a.id, b.id, c.id].sort());
    expect(root.via).toBeUndefined();
    expect(root.candidates.map((x) => [x.label, x.count, x.judgement, x.loss])).toEqual([
      ["▲1六歩", 2, "good", 0],
      ["▲9六歩", 1, "mistake", 400],
    ]);
    expect(root.children).toHaveLength(1);
    const child = root.children[0]!;
    expect(child).toMatchObject({
      ply: 19,
      kind: "opponent",
      mover: "opponent",
      key: a.positions[19],
      via: { usi: "1g1f", label: "▲1六歩" },
      children: [],
    });
    expect(child.gameIds).toEqual([a.id, c.id].sort());
    expect(child.candidates.map((x) => [x.label, x.judgement])).toEqual([
      ["△1四歩", "good"],
      ["△9四歩", null],
    ]);
    expect(flattenBranchTree(trees[0]!.roots).map((x) => [x.node.ply, x.depth])).toEqual([
      [18, 0],
      [19, 1],
    ]);
  });

  it("本人の側ごとに別の木にする", async () => {
    const { a, b } = await games();
    const w1 = { ...a, id: "w1", black: "jiro", white: "taro" };
    const w2 = { ...b, id: "w2", black: "saburo", white: "taro" };
    const trees = buildBranchTrees([a, b, w1, w2], new Map(), "taro");
    expect(trees.map((t) => [t.side, t.roots.map((r) => r.gameIds)])).toEqual([
      ["black", [[a.id, b.id].sort()]],
      ["white", [["w1", "w2"]]],
    ]);
    expect(trees[1]!.roots[0]).toMatchObject({ mover: "opponent", kind: "unanalyzed" });
  });

  it("分岐点はその戦法の対局だけで求める。別の戦法の共通局面は混ざらず、戦法の分岐点はすべて木に入る", async () => {
    const { a, b, c } = await games();
    // 別の戦法 (と見なす) の 4 局。a と同じ手順なので 19 手目まで a / c と共通
    const others = ["d", "e", "f", "g"].map((id) => ({
      ...a,
      id,
      opening: { ...a.opening, blackOpening: "三間飛車" },
    }));
    const all = [a, b, c, ...others];
    const mine = [a, b, c];
    const ids = new Set(mine.map((g) => g.id));
    // 全対局で求めると 18 手目の分岐点は 7 局のうち 3 局しかこの戦法でなく、多数決ではどこにも入らなかった
    const global = findCommonPositions(all, "taro").find((p) => p.key === a.positions[18])!;
    expect(global.gameIds).toHaveLength(7);
    const nodes = buildBranchTrees(mine, new Map(), "taro").flatMap((t) =>
      flattenBranchTree(t.roots),
    );
    expect(nodes.map((x) => x.node.key)).toContain(a.positions[18]);
    for (const { node } of nodes) {
      expect(node.gameIds.every((id) => ids.has(id))).toBe(true);
      expect(node.opening).toBe("ノーマル四間飛車");
    }
    expect(nodes.map((x) => x.node.key).sort()).toEqual(
      findCommonPositions(mine, "taro")
        .map((p) => p.key)
        .sort(),
    );
    // 別の戦法の木にもこの戦法の対局は入らない
    const otherNodes = buildBranchTrees(others, new Map(), "taro").flatMap((t) =>
      flattenBranchTree(t.roots),
    );
    expect(otherNodes.every(({ node }) => node.gameIds.every((id) => !ids.has(id)))).toBe(true);
  });
});
