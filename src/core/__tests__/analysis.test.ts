import { describe, expect, it } from "vitest";
import {
  MATE_CP,
  judge,
  phaseOf,
  reviewGame,
  reviewMoves,
  winProbability,
  type AnalysisRecord,
} from "../analysis";
import { annotatedKif } from "../annotate";
import { parseKifu } from "../parse";
import { buildPlayerProfile, profileToMarkdown } from "../profile";
import { USI_SHIKEN_VS_FUNA, WARS_KIF } from "./fixtures";

const source = { kind: "paste" as const };

/** 評価値の列から解析結果を組み立てる (テスト用) */
export function fakeAnalysis(
  id: string,
  cps: number[],
  best: Record<number, string> = {},
): AnalysisRecord {
  return {
    schema: 1,
    id,
    engine: { name: "fake", depth: 1 },
    analyzedAt: "2026-01-01T00:00:00Z",
    plies: cps.map((cp, ply) =>
      best[ply] ? { ply, cp, best: best[ply], pv: [best[ply]!] } : { ply, cp },
    ),
  };
}

describe("analysis", () => {
  it("勝率変換と判定", () => {
    expect(winProbability(0)).toBeCloseTo(0.5);
    expect(winProbability(600)).toBeGreaterThan(0.7);
    expect(winProbability(-600)).toBeLessThan(0.3);
    expect(judge(0.01, 20)).toBe("good");
    expect(judge(0.06, 130)).toBe("inaccuracy");
    expect(judge(0.15, 400)).toBe("mistake");
    expect(judge(0.3, 900)).toBe("blunder");
    expect(judge(0, 900)).toBe("blunder");
  });

  it("段階の区分", () => {
    expect(phaseOf(10, 100)).toBe("opening");
    expect(phaseOf(50, 100)).toBe("middlegame");
    expect(phaseOf(80, 100)).toBe("endgame");
    expect(phaseOf(45, 60)).toBe("endgame");
    expect(phaseOf(40, 45)).toBe("middlegame");
  });

  it("各手の損失は指した側から見て計算される", async () => {
    const g = await parseKifu(WARS_KIF, { source });
    // 14 手。先手の 5 手目 (6八飛) で先手が 400 損し、後手の 8 手目で後手が 1000 損する
    const cps = [0, 10, 0, 20, 0, -400, -380, -400, 600, 580, 600, 620, 600, 610, 600];
    const a = fakeAnalysis(g.id, cps, { 4: "2g2f", 7: "7a6b" });
    const moves = reviewMoves(g, a);
    expect(moves).toHaveLength(14);
    const m5 = moves[4]!;
    expect(m5.side).toBe("black");
    expect(m5.loss).toBe(400);
    expect(m5.best).toBe("2g2f");
    expect(m5.judgement).toBe("mistake");
    const m8 = moves[7]!;
    expect(m8.side).toBe("white");
    expect(m8.loss).toBe(1000);
    expect(m8.judgement).toBe("blunder");
    // 指した手が最善なら best は付かない
    expect(moves[6]!.best).toBeUndefined();
    // 指した側にとって評価が上がった手の損失は 0 (2 手目: 後手が +10 → 0 に戻した)
    expect(moves[1]!.loss).toBe(0);

    const review = reviewGame(g, a);
    expect(review.black.counts.mistake).toBe(1);
    expect(review.white.counts.blunder).toBe(1);
    expect(review.white.averageLoss).toBeGreaterThan(review.black.averageLoss);
    expect(review.curve).toHaveLength(15);
  });

  it("詰みの評価値は上限に丸めた cp として扱える", () => {
    expect(winProbability(MATE_CP)).toBeGreaterThan(0.99);
  });

  it("対局者プロファイル", async () => {
    const a = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
    const b = await parseKifu(WARS_KIF, { source });
    Object.assign(a, { black: "taro", white: "x", result: "white" });
    Object.assign(b, { black: "y", white: "taro", result: "white" });
    const analyses = new Map([
      // a: taro (先手) が中盤で崩れて負け
      [
        a.id,
        fakeAnalysis(
          a.id,
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -900, -900, -900, -900, -900, -900],
          { 14: "1g1f" },
        ),
      ],
      // b: taro (後手) が有利を活かして勝ち。相手 (先手) が 5 手目で大悪手
      [
        b.id,
        fakeAnalysis(
          b.id,
          [0, 0, 0, 0, 0, -900, -900, -900, -900, -900, -900, -900, -900, -900, -900],
        ),
      ],
    ]);
    const p = buildPlayerProfile([a, b], analyses, "taro");
    expect(p.games).toBe(2);
    expect(p.worstMoves[0]).toMatchObject({
      gameId: a.id,
      ply: 15,
      side: "black",
      best: "1g1f",
      judgement: "blunder",
    });
    expect(p.conversionRate).toBe(1); // b で有利になり勝った
    expect(p.resilienceRate).toBe(0); // a で不利になり負けた
    expect(p.punishRate).toBe(1);
    expect(p.firstBlunderRate).toBe(0.5);
    expect(p.byOpening.find((o) => o.name === "四間飛車")?.games).toBe(1);
    const md = profileToMarkdown(p);
    expect(md).toContain("# taro の弱点プロファイル");
    expect(md).toContain("四間飛車");
    expect(md).not.toContain("undefined");
  });

  it("解析つき KIF にコメントが入る", async () => {
    const g = await parseKifu(WARS_KIF, { source });
    const cps = [0, 10, 0, 20, 0, -400, -380, -400, 600, 580, 600, 620, 600, 610, 600];
    const a = fakeAnalysis(g.id, cps, { 4: "2g2f", 7: "7a6b" });
    const kif = annotatedKif(g, a);
    expect(kif).toContain("*評価値 -400");
    expect(kif).toContain("*悪手 (損失 400)");
    expect(kif).toContain("*最善 ☗２六歩");
    expect(kif).toContain("*大悪手 (損失 1000)");
  });
});
