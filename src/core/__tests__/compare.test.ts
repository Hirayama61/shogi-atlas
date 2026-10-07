import { describe, expect, it } from "vitest";
import type { AnalysisRecord } from "../analysis";
import { compareOpenings, comparePlayers } from "../compare";
import { parseKifu } from "../parse";
import type { GameRecord } from "../types";
import { USI_KAKUGAWARI, USI_SHIKEN_VS_FUNA } from "./fixtures";

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

async function game(usi: string, black: string, white: string): Promise<GameRecord> {
  const g = await parseKifu(usi, { source });
  return Object.assign(g, { black, white, result: "black" as const });
}

/** 18 手目までは同じ。19 手目 (先手の手番) が 1g1f か 9g9f、20 手目が 1c1d か 9c9d */
const usi = (m19: string, m20: string) => USI_SHIKEN_VS_FUNA.replace("1g1f 1c1d", `${m19} ${m20}`);

function compare(gs: GameRecord[], analyses: AnalysisRecord[] = [], opening?: string) {
  const map = new Map(analyses.map((x) => [x.id, x] as const));
  return comparePlayers(gs, map, "me", "ref", opening === undefined ? {} : { opening });
}

describe("comparePlayers", () => {
  it("2 人の手順が分かれる直前の局面に、各自の手と判定・最善手を返す", async () => {
    const a = await game(usi("1g1f", "1c1d"), "me", "x1");
    const b = await game(usi("9g9f", "9c9d"), "ref", "x2");
    const bad = flat.map((cp, ply) => (ply >= 19 ? -400 : cp));
    const c = compare([a, b], [fakeAnalysis(a.id, flat), fakeAnalysis(b.id, bad, { 18: "1g1f" })]);
    expect(c.positions).toHaveLength(1);
    const p = c.positions[0]!;
    expect(p).toMatchObject({ ply: 18, side: "black", differs: true, key: a.positions[18] });
    expect(p.self.gameIds).toEqual([a.id]);
    expect(p.other.gameIds).toEqual([b.id]);
    expect(p.self.moves).toEqual([
      expect.objectContaining({ usi: "1g1f", label: "▲1六歩", count: 1, judgement: "good" }),
    ]);
    expect(p.other.moves[0]).toMatchObject({ usi: "9g9f", label: "▲9六歩", bestLabel: "▲1六歩" });
    expect(p.other.moves[0]!.judgement).not.toBe("good");
    expect(c.games).toEqual({ black: { self: 1, other: 1 }, white: { self: 0, other: 0 } });
  });

  it("同じ手を指した局面は一致として返し、解析が無ければ判定は null", async () => {
    const a = await game(usi("1g1f", "1c1d"), "me", "x1");
    const b = await game(usi("1g1f", "9c9d"), "ref", "x2");
    const { positions } = compare([a, b]);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({ ply: 18, differs: false });
    expect(positions[0]!.self.moves[0]).toMatchObject({ usi: "1g1f", judgement: null });
    expect(positions[0]!.other.moves[0]).toMatchObject({ usi: "1g1f", judgement: null });
  });

  it("手の分布を数え、片方にしか無い手があれば違う局面になる", async () => {
    const a = await game(usi("1g1f", "1c1d"), "me", "x1");
    const a2 = await game(usi("9g9f", "1c1d"), "me", "x3");
    const b = await game(usi("1g1f", "9c9d"), "ref", "x2");
    const { positions } = compare([a, a2, b]);
    const p = positions.find((x) => x.ply === 18)!;
    expect(p.differs).toBe(true);
    expect(p.self.moves.map((m) => [m.usi, m.count])).toEqual([
      ["1g1f", 1],
      ["9g9f", 1],
    ]);
    expect(p.other.moves.map((m) => m.usi)).toEqual(["1g1f"]);
    // 手数の早い順
    expect(positions.map((x) => x.ply)).toEqual(
      [...positions.map((x) => x.ply)].sort((x, y) => x - y),
    );
  });

  it("同じ手順で終わった対局同士は、最後に指した局面を一致として返す", async () => {
    const a = await game(USI_KAKUGAWARI, "me", "x1");
    // 最後の手 (後手) だけ違う別の対局 (同じ棋譜だと同じ ID になる)
    const b = await game(USI_KAKUGAWARI.replace(/6a5b$/, "9c9d"), "ref", "x2");
    expect(b.id).not.toBe(a.id);
    const { positions } = compare([a, b]);
    // 14 手の棋譜。先手の手番で次の手があるのは 12 手目まで
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({ ply: 12, differs: false });
    expect(positions[0]!.self.moves[0]).toMatchObject({ usi: "6i7h" });
  });

  it("先後が逆の対局同士は共通局面として出ない", async () => {
    // 同じ手順でも、自分は後手、参考の人は先手
    const a = await game(usi("1g1f", "1c1d"), "x1", "me");
    const b = await game(usi("1g1f", "9c9d"), "ref", "x2");
    const c = compare([a, b]);
    expect(c.positions).toEqual([]);
    expect(c.games).toEqual({ black: { self: 0, other: 1 }, white: { self: 1, other: 0 } });
  });

  it("共通局面が無ければ空を返す", async () => {
    const a = await game(usi("1g1f", "1c1d"), "me", "x1");
    const b = await game(USI_KAKUGAWARI, "ref", "x2");
    expect(compare([a, b]).positions).toEqual([]);
    expect(compare([a]).positions).toEqual([]);
  });

  it("戦法で絞れる", async () => {
    const a = await game(usi("1g1f", "1c1d"), "me", "x1");
    const b = await game(usi("9g9f", "9c9d"), "ref", "x2");
    const k = await game(USI_KAKUGAWARI, "ref", "x3");
    const opening = a.opening.blackOpening;
    expect(compareOpenings([a, b, k], "me", "ref")).toEqual([opening]);
    expect(compare([a, b, k], [], opening).positions).toHaveLength(1);
    expect(compare([a, b, k], [], opening).games.black).toEqual({ self: 1, other: 1 });
    expect(compare([a, b, k], [], "存在しない戦法").positions).toEqual([]);
  });
});
