import { describe, expect, it } from "vitest";
import {
  MATE_CP,
  isAnalysisStale,
  judge,
  normalizeAnalysis,
  phaseOf,
  reviewGame,
  reviewMoves,
  winProbability,
  type AnalysisRecord,
} from "../analysis";
import { annotatedKif } from "../annotate";
import { parseKifu } from "../parse";
import { buildPlayerProfile, profileToMarkdown, rateOf } from "../profile";
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
    // 最善手の無い解析では一致したとも言わない
    expect(moves[6]!.playedBest).toBeUndefined();
    expect(m5.playedBest).toBeUndefined();
    // 最善手と一致した手には印が付く
    const first = g.usi.replace(/^position startpos moves\s*/, "").split(/\s+/)[0]!;
    const agreed = reviewMoves(g, fakeAnalysis(g.id, cps, { 0: first }))[0]!;
    expect(agreed.playedBest).toBe(true);
    expect(agreed.best).toBeUndefined();
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
          { 5: "8c8d" },
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
    // 率は内訳から導かれる
    expect(p.conversionRate).toBe(rateOf(p.rates.conversion));
    expect(p.resilienceRate).toBe(rateOf(p.rates.resilience));
    expect(p.punishRate).toBe(rateOf(p.rates.punish));
    expect(p.firstBlunderRate).toBe(rateOf(p.rates.firstBlunder));
    // 有利: b で初めて +300 を越えた 5 手目の局面
    expect(p.rates.conversion).toEqual([
      expect.objectContaining({ gameId: b.id, opponent: "y", ply: 5, cp: 900, hit: true }),
    ]);
    expect(p.rates.conversion[0]!.sfen).toBe(b.positions[5]);
    // 不利: a で初めて -300 を越えた 15 手目の局面で、負けた
    expect(p.rates.resilience).toEqual([
      expect.objectContaining({ gameId: a.id, side: "black", ply: 15, cp: -900, hit: false }),
    ]);
    // 咎めた: b で相手が 5 手目に大悪手。最善手は本人 (後手) が 6 手目に指すべきだった手
    expect(p.rates.punish).toEqual([
      expect.objectContaining({
        gameId: b.id,
        ply: 5,
        by: "black",
        played: "2h6h",
        best: "8c8d",
        hit: true,
      }),
    ]);
    // 先に大悪手: a は本人が先 (15 手目を指す前の局面)、b は相手が先
    const first = new Map(p.rates.firstBlunder.map((e) => [e.gameId, e] as const));
    expect(first.get(a.id)).toMatchObject({ ply: 14, by: "black", best: "1g1f", hit: true });
    expect(first.get(b.id)).toMatchObject({ ply: 4, by: "black", hit: false });
    expect(p.byOpening.find((o) => o.name === "ノーマル四間飛車")?.games).toBe(1);
    const md = profileToMarkdown(p);
    expect(md).toContain("# taro の弱点プロファイル");
    expect(md).toContain("四間飛車");
    expect(md).not.toContain("undefined");
  });

  it("内訳が空なら率は null", () => {
    expect(rateOf([])).toBeNull();
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

  it("手順が変わったときだけ解析は古いとみなす", () => {
    const usi = "position startpos moves 7g7f 3c3d";
    const a = { ...fakeAnalysis("x", [0, 0, 0]), game: { importedAt: "t1", length: 2, usi } };
    expect(isAnalysisStale({ length: 2, usi }, a)).toBe(false);
    // reindex で importedAt だけ変わった (戦法ラベルの更新など) なら解析し直さない
    const reindexed = { importedAt: "t2", length: 2, usi };
    expect(isAnalysisStale(reindexed, a)).toBe(false);
    // 手順が変わった・手数が変わったならやり直す
    expect(isAnalysisStale({ length: 2, usi: "position startpos moves 2g2f 8c8d" }, a)).toBe(true);
    expect(isAnalysisStale({ length: 5, usi }, a)).toBe(true);
  });

  it("手順を持たない古い解析は手数が合えば使う", () => {
    const old = { ...fakeAnalysis("x", [0, 0, 0]), game: { importedAt: "t1", length: 2 } };
    const usi = "position startpos moves 7g7f 3c3d";
    expect(isAnalysisStale({ length: 2, usi }, old)).toBe(false);
    expect(isAnalysisStale({ length: 3, usi: `${usi} 2g2f` }, old)).toBe(true);
    expect(isAnalysisStale({ length: 2, usi }, fakeAnalysis("x", [0, 0, 0]))).toBe(false);
    // normalize しても手順を持たないまま読める
    const n = normalizeAnalysis(JSON.parse(JSON.stringify(old)))!;
    expect(n.game).toEqual({ importedAt: "t1", length: 2 });
    expect(isAnalysisStale({ length: 2, usi }, n)).toBe(false);
  });
});
