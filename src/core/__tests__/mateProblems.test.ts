import { describe, expect, it } from "vitest";
import type { AnalysisRecord, PlyEval } from "../analysis";
import { nextProblem } from "../endgame";
import {
  buildMateProblems,
  extractMateProblems,
  mateFilterCounts,
  solveMateProblem,
} from "../mateProblems";
import { parseKifu } from "../parse";
import { SELF_NAME } from "../self";
import type { GameRecord } from "../types";
import { USI_TSUMERO_A, USI_TSUMERO_B, USI_TSUMERO_C } from "./fixtures";

const source = { kind: "paste" as const };

function fakeAnalysis(id: string, plies: Array<Omit<PlyEval, "ply">>): AnalysisRecord {
  return {
    schema: 1,
    id,
    engine: { name: "fake", depth: 1 },
    analyzedAt: "2026-01-01T00:00:00Z",
    plies: plies.map((p, ply) => ({ ply, ...p })),
  };
}

async function game(usi: string, black: string, white: string, startedAt: string) {
  const g = await parseKifu(usi, { source });
  Object.assign(g, { black, white, startedAt });
  Object.assign(g.opening, { blackCastle: "不明", whiteCastle: "穴熊" });
  return g;
}

async function fixtures() {
  const a = await game(USI_TSUMERO_A, "taro", "jiro", "2026-01-02T00:00:00Z");
  const b = await game(USI_TSUMERO_B, SELF_NAME, "saburo", "2026-01-01T00:00:00Z");
  const c = await game(USI_TSUMERO_C, "shiro", "goro", "2026-01-03T00:00:00Z");
  const analyses = new Map<string, AnalysisRecord>([
    [
      a.id,
      fakeAnalysis(a.id, [
        { cp: 800, best: "2d2c" },
        { cp: 3000, mate: -3 },
        { cp: 3000, mate: 1, best: "G*2b" },
        { cp: 3000 },
      ]),
    ],
    [
      b.id,
      fakeAnalysis(b.id, [
        { cp: 800, best: "2d2c" },
        { cp: 3000, mate: -3 },
        { cp: 3000, mate: 1, best: "G*2b" },
        { cp: 300 },
      ]),
    ],
    [
      c.id,
      fakeAnalysis(c.id, [
        { cp: 3000, mate: 3, best: "B*3c" },
        { cp: 3000, mate: -2 },
        { cp: 3000, mate: 1, best: "G*2b" },
        { cp: 3000 },
      ]),
    ],
  ]);
  return { a, b, c, analyses };
}

describe("extractMateProblems", () => {
  it("詰みの 2 手前の局面を詰めろの問題にする", async () => {
    const { a, analyses } = await fixtures();
    const [p, ...rest] = extractMateProblems(a, analyses.get(a.id));
    expect(rest).toEqual([]);
    expect(p).toMatchObject({
      id: `mate:${a.id}:1`,
      ply: 1,
      sfen: "8k/8p/9/7P1/9/9/9/9/K8 b G 1",
      side: "black",
      mover: "taro",
      opponent: "jiro",
      castle: "穴熊",
      mateLength: 1,
      played: "2d2c",
      reply: "1b1c",
      best: "2d2c",
      missed: false,
    });
  });

  it("実戦で詰みを逃したら missed", async () => {
    const { b, analyses } = await fixtures();
    expect(extractMateProblems(b, analyses.get(b.id))[0]?.missed).toBe(true);
  });

  it("2 手前にすでに詰みがある局面、解析の無い対局、上限より長い詰みは問題にしない", async () => {
    const { a, c, analyses } = await fixtures();
    expect(extractMateProblems(c, analyses.get(c.id))).toEqual([]);
    expect(extractMateProblems(a, undefined)).toEqual([]);
    expect(extractMateProblems(a, analyses.get(a.id), 0)).toEqual([]);
  });
});

describe("buildMateProblems", () => {
  it("全棋譜の問題を、逃した問題を先頭に並べる", async () => {
    const { a, b, c, analyses } = await fixtures();
    const problems = buildMateProblems([a, b, c] as GameRecord[], analyses);
    expect(problems.map((p) => p.gameId)).toEqual([b.id, a.id]);
    expect(mateFilterCounts(problems)).toEqual({
      lengths: [{ length: 1, problems: 2 }],
      castles: [{ castle: "穴熊", problems: 2 }],
    });
    // 出題順は囲い崩しと同じ記録で決まる: 未出題 → 不正解 → 正解、同じなら自分が逃した問題
    expect(nextProblem(problems, {})?.gameId).toBe(b.id);
    const records = { [problems[0]!.id]: { attempts: 1, correct: true } };
    expect(nextProblem(problems, records)?.gameId).toBe(a.id);
  });
});

describe("solveMateProblem", () => {
  it("実戦の詰めろと応手で詰む手順を返す", async () => {
    const { a, analyses } = await fixtures();
    const [p] = extractMateProblems(a, analyses.get(a.id));
    expect(solveMateProblem(p!)).toEqual({ tsumero: "2d2c", reply: "1b1c", mate: ["G*2b"] });
  });

  it("実戦の手が詰めろでなければエンジンの最善手を使い、どちらも違えば null", () => {
    const sfen = "8k/8p/9/7P1/9/9/9/9/K8 b G 1";
    expect(solveMateProblem({ sfen, played: "9i9h", reply: "1b1c", best: "2d2c" })?.tsumero).toBe(
      "2d2c",
    );
    expect(solveMateProblem({ sfen, played: "9i9h", reply: "1b1c" })).toBeNull();
  });
});
