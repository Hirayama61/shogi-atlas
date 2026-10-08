import { describe, expect, it } from "vitest";
import type { AnalysisRecord } from "../analysis";
import {
  buildProblemGroups,
  castleCounts,
  extractProblems,
  formatLine,
  kingShapeKey,
  nextProblem,
  orderProblems,
  problemChoices,
} from "../endgame";
import { parseKifu } from "../parse";
import { SELF_NAME } from "../self";
import type { GameRecord } from "../types";
import { USI_ENDGAME_A, USI_ENDGAME_B, USI_ENDGAME_C } from "./fixtures";

const source = { kind: "paste" as const };

function fakeAnalysis(
  id: string,
  plies: Array<{ cp: number; best?: string; pv?: string[] }>,
): AnalysisRecord {
  return {
    schema: 1,
    id,
    engine: { name: "fake", depth: 1 },
    analyzedAt: "2026-01-01T00:00:00Z",
    plies: plies.map((p, ply) => ({ ply, ...p })),
  };
}

async function game(
  usi: string,
  black: string,
  white: string,
  castle: Partial<GameRecord["opening"]>,
) {
  const g = await parseKifu(usi, { source });
  Object.assign(g, { black, white });
  Object.assign(g.opening, { blackCastle: "不明", whiteCastle: "不明", ...castle });
  return g;
}

async function fixtures() {
  const a = await game(USI_ENDGAME_A, "taro", "jiro", { whiteCastle: "美濃囲い" });
  const b = await game(USI_ENDGAME_B, SELF_NAME, "saburo", { whiteCastle: "美濃囲い" });
  const c = await game(USI_ENDGAME_C, "shiro", "goro", { blackCastle: "美濃囲い" });
  const analyses = new Map<string, AnalysisRecord>([
    [
      a.id,
      fakeAnalysis(a.id, [
        { cp: 500, best: "R*2a", pv: ["R*2a", "3b2a"] },
        { cp: 500, best: "3b2a" },
        { cp: 500 },
      ]),
    ],
    [b.id, fakeAnalysis(b.id, [{ cp: 500, best: "R*2a" }, { cp: -200 }])],
    [c.id, fakeAnalysis(c.id, [{ cp: -500, best: "R*8i" }, { cp: 200 }])],
  ]);
  return { a, b, c, analyses };
}

describe("kingShapeKey", () => {
  it("同じ形は同じキー、違う形は違うキー、先後が逆でも同じキーになる", async () => {
    const { a, b, c } = await fixtures();
    const key = kingShapeKey(a.positions[0]!, "white");
    // ☖玉 2二 を回して ☗玉 8八 に揃える。7 段目に歩 3 枚、8 段目の 7 筋に銀
    expect(key).toBe("88:P,P,P,.,K,S,.,.,.");
    // 別の対局の同じ局面
    expect(kingShapeKey(b.positions[0]!, "white")).toBe(key);
    // 盤を回した局面 (☗が守る側)
    expect(kingShapeKey(c.positions[0]!, "black")).toBe(key);
    // 飛車が 2 一 に入ると形が変わる
    expect(kingShapeKey(a.positions[1]!, "white")).not.toBe(key);
    // 玉が無い側は null
    expect(kingShapeKey("9/9/9/9/9/9/9/9/9 b - ", "black")).toBeNull();
  });
});

describe("extractProblems", () => {
  it("崩し方 (最善の駒打ち・逃した最善手) と崩され方 (打たれた駒を最善で取る) を抜き出す", async () => {
    const { a, b, c, analyses } = await fixtures();
    const pa = extractProblems(a, analyses.get(a.id));
    expect(pa.map((p) => [p.kind, p.ply, p.side, p.castle, p.best, p.missed])).toEqual([
      ["attack", 1, "black", "美濃囲い", "R*2a", false],
      ["defense", 2, "white", "美濃囲い", "3b2a", false],
    ]);
    expect(pa[0]).toMatchObject({ mover: "taro", opponent: "jiro", pv: ["R*2a", "3b2a"] });
    expect(pa[0]!.sfen).toBe(`${a.positions[0]} 1`);
    const [pb] = extractProblems(b, analyses.get(b.id));
    expect(pb).toMatchObject({
      kind: "attack",
      played: "9i8h",
      best: "R*2a",
      loss: 700,
      missed: true,
    });
    const [pc] = extractProblems(c, analyses.get(c.id));
    expect(pc).toMatchObject({ kind: "attack", side: "white", best: "R*8i", missed: true });
    expect(pc!.shape).toBe(pb!.shape);
  });

  it("解析が無い、囲いが不明、序盤、大差で負けの局面からは作らない", async () => {
    const { a, analyses } = await fixtures();
    expect(extractProblems(a, undefined)).toEqual([]);
    // 序盤 (30 手目まで) の局面。開始局面に駒を足して対局の初めからに見せる
    const early = {
      ...a,
      positions: [
        "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b -",
        ...a.positions.slice(1),
      ],
    };
    expect(extractProblems(early, analyses.get(a.id))).toEqual([]);
    // 序盤を含めれば 2 手目 (崩され方) は問題になる
    expect(extractProblems(early, analyses.get(a.id), 0).map((p) => p.ply)).toEqual([2]);
    const unknown = { ...a, opening: { ...a.opening, whiteCastle: "不明" } };
    expect(extractProblems(unknown, analyses.get(a.id))).toEqual([]);
    const lost = fakeAnalysis(a.id, [
      { cp: -2000, best: "R*2a" },
      { cp: -2000, best: "3b2a" },
      { cp: -2000 },
    ]);
    // ☗は大差で負け (崩し方は作らない)、☖は大差で勝ち (崩され方は作る)
    expect(extractProblems(a, lost).map((p) => p.kind)).toEqual(["defense"]);
  });
});

describe("buildProblemGroups", () => {
  it("囲いと玉周りの形で問題群にまとめ、自分が逃した群を先頭にする", async () => {
    const { a, b, c, analyses } = await fixtures();
    const groups = buildProblemGroups([a, c, b], analyses);
    expect(
      groups.map((g) => [g.kind, g.castle, g.problems.length, g.games, g.self, g.selfMissed]),
    ).toEqual([
      ["attack", "美濃囲い", 3, 3, 1, 1],
      ["defense", "美濃囲い", 1, 1, 0, 0],
    ]);
    expect(groups[0]!.movers).toEqual(["goro", "taro", SELF_NAME]);
    expect(castleCounts(groups)).toEqual([{ castle: "美濃囲い", problems: 4 }]);
    // 自分の対局が無ければ問題の多い群が先
    const others = buildProblemGroups([a, c], analyses);
    expect(others.map((g) => [g.kind, g.problems.length])).toEqual([
      ["attack", 2],
      ["defense", 1],
    ]);
  });

  it("出題は未出題 → 不正解 → 正解の順で、未出題の中では自分が逃した問題が先", async () => {
    const { a, b, c, analyses } = await fixtures();
    const [group] = buildProblemGroups([a, b, c], analyses);
    const ids = (records: Parameters<typeof orderProblems>[1]) =>
      orderProblems(group!.problems, records).map((p) => p.gameId);
    expect(ids({})[0]).toBe(b.id);
    expect(ids({ [`${b.id}:1`]: { attempts: 1, correct: true } }).at(-1)).toBe(b.id);
    const order = ids({
      [`${b.id}:1`]: { attempts: 1, correct: true },
      [`${a.id}:1`]: { attempts: 2, correct: false },
    });
    expect(order).toEqual([c.id, a.id, b.id]);
    // 今の問題は後回し
    expect(nextProblem(group!.problems, {}, `${b.id}:1`)?.gameId).not.toBe(b.id);
  });
});

describe("problemChoices / formatLine", () => {
  it("最善手と実戦の手を含む合法手の選択肢を、問題ごとに同じ並びで返す", async () => {
    const { b, analyses } = await fixtures();
    const [p] = extractProblems(b, analyses.get(b.id));
    const choices = problemChoices(p!);
    expect(choices).toHaveLength(4);
    expect(choices.map((x) => x.usi)).toEqual(expect.arrayContaining(["R*2a", "9i8h"]));
    expect(choices.find((x) => x.usi === "R*2a")?.label).toBe("▲2一飛");
    expect(new Set(choices.map((x) => x.label)).size).toBe(4);
    expect(problemChoices(p!)).toEqual(choices);
  });

  it("読み筋を表記にする", async () => {
    const { a } = await fixtures();
    expect(formatLine(`${a.positions[0]} 1`, ["R*2a", "3b2a", "9i9h"])).toEqual([
      "▲2一飛",
      "△同　銀",
      "▲9八玉",
    ]);
  });
});
