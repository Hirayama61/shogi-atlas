import { describe, expect, it } from "vitest";
import type { AnalysisRecord } from "../analysis";
import { compareCounters, compareOpenings, comparePlayers, groupByOpening } from "../compare";
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

/**
 * 18 手目で分かれる 4 局。自分の a1 は ▲1六歩→▲9六歩、a2 と参考の b は ▲9六歩→▲1六歩 で、
 * 22 手目に同じ局面に合流する (手順前後)。参考の b2 は 20 手目で ▲2六歩 と本当に分かれる。
 */
async function transposed() {
  const base = (rest: string) => USI_SHIKEN_VS_FUNA.replace("1g1f 1c1d", rest);
  return {
    a1: await game(base("1g1f 1c1d 9g9f 9c9d"), "me", "x1"),
    a2: await game(base("9g9f 1c1d 1g1f 9c9d 5g5f"), "me", "x2"),
    b: await game(base("9g9f 1c1d 1g1f 9c9d"), "ref", "x3"),
    b2: await game(base("9g9f 1c1d 2g2f"), "ref", "x4"),
  };
}

describe("groupByOpening", () => {
  it("数手以内に合流する分岐を merged、合流しない分岐を differs にし、戦法ごとにまとめる", async () => {
    const { a1, a2, b, b2 } = await transposed();
    const games = [a1, a2, b, b2];
    const c = compare(games);
    const groups = groupByOpening(c, games, "me", "ref");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.opening).toBe(a1.opening.blackOpening);
    expect(groups[0]!.branches.map((x) => [x.ply, x.kind])).toEqual([
      [18, "merged"],
      [20, "differs"],
    ]);
    const real = groups[0]!.branches[1]!;
    expect(real.self.moves.map((m) => m.label)).toEqual(["▲1六歩"]);
    expect(real.other.moves.map((m) => m.label)).toEqual(["▲1六歩", "▲2六歩"]);
  });

  it("合流しない分岐は differs、同じ手は same", async () => {
    const a = await game(usi("1g1f", "1c1d"), "me", "x1");
    const b = await game(usi("9g9f", "9c9d"), "ref", "x2");
    const k1 = await game(USI_KAKUGAWARI, "me", "x3");
    const k2 = await game(USI_KAKUGAWARI.replace(/6a5b$/, "9c9d"), "ref", "x4");
    const games = [a, b, k1, k2];
    const groups = groupByOpening(compare(games), games, "me", "ref");
    expect(groups.map((g) => [g.opening, g.branches.map((x) => x.kind)])).toEqual([
      [a.opening.blackOpening, ["differs"]],
      [k1.opening.blackOpening, ["same"]],
    ]);
  });
});

describe("compareCounters", () => {
  it("相手の戦法ごとに 2 人の応手 (戦法 × 囲い) と勝敗を並べ、最も多い応手が違えば differs", async () => {
    const as = (g: GameRecord, opening: string, castle: string, vs: string) =>
      Object.assign(g, {
        opening: { ...g.opening, blackOpening: opening, blackCastle: castle, whiteOpening: vs },
      });
    const g1 = as(
      await game(usi("1g1f", "1c1d"), "me", "x1"),
      "四間飛車",
      "美濃囲い",
      "居飛車急戦",
    );
    const g2 = as(
      await game(usi("9g9f", "1c1d"), "me", "x2"),
      "四間飛車",
      "美濃囲い",
      "居飛車急戦",
    );
    const g3 = as(await game(usi("9g9f", "9c9d"), "ref", "x3"), "三間飛車", "穴熊", "居飛車急戦");
    const g4 = as(await game(USI_KAKUGAWARI, "me", "x4"), "角換わり", "矢倉", "角換わり");
    const rows = compareCounters([g1, g2, g3, g4], "me", "ref");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      vsOpening: "居飛車急戦",
      differs: true,
      self: [{ name: "四間飛車 · 美濃囲い", games: 2, wins: 2, losses: 0 }],
      other: [{ name: "三間飛車 · 穴熊", games: 1, wins: 1 }],
    });
    expect(compareCounters([g1, g2, g3], "me", "ref", { opening: "四間飛車" })).toEqual([]);
  });
});
