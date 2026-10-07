import { describe, expect, it } from "vitest";
import { buildPlayerProfile, type RateEvidence } from "../profile";
import { accuracyScore, averageAxes, radarAxes } from "../radar";

const ev = (hit: boolean): RateEvidence => ({
  gameId: "g",
  opponent: "o",
  side: "black",
  ply: 1,
  sfen: "",
  cp: 0,
  hit,
});

describe("radar", () => {
  it("平均損失を 0〜100 に換算する (0 で 100、300 以上で 0)", () => {
    expect(accuracyScore(0)).toBe(100);
    expect(accuracyScore(150)).toBe(50);
    expect(accuracyScore(300)).toBe(0);
    expect(accuracyScore(900)).toBe(0);
  });

  it("解析の無い軸は null、率は割合、先に崩れないは反転", () => {
    const p = buildPlayerProfile([], new Map(), "x");
    p.byPhase.opening = { moves: 10, averageLoss: 30, blunderRate: 0.1 };
    p.rates.conversion = [ev(true), ev(true), ev(false), ev(true)];
    p.rates.firstBlunder = [ev(true), ev(false), ev(false), ev(false)];
    const axes = radarAxes(p);
    expect(axes.map((a) => a.key)).toEqual([
      "opening",
      "middlegame",
      "endgame",
      "conversion",
      "resilience",
      "punish",
      "firstBlunder",
    ]);
    const by = Object.fromEntries(axes.map((a) => [a.key, a]));
    expect(by.opening).toMatchObject({ score: 90, raw: "平均損失 30 · 大悪手 10%" });
    expect(by.middlegame!.score).toBeNull();
    expect(by.conversion).toMatchObject({ score: 75, raw: "3/4 局" });
    expect(by.resilience).toMatchObject({ score: null, raw: "該当なし" });
    // 自分が先に大悪手を指したのは 1/4 → 崩れなかったのは 3/4
    expect(by.firstBlunder).toMatchObject({ score: 75, raw: "3/4 局" });
  });

  it("平均は null を除いて軸ごとに取る", () => {
    const a = buildPlayerProfile([], new Map(), "a");
    a.rates.punish = [ev(true)];
    const b = buildPlayerProfile([], new Map(), "b");
    b.rates.punish = [ev(false)];
    b.byPhase.endgame = { moves: 5, averageLoss: 0, blunderRate: 0 };
    const avg = averageAxes([radarAxes(a), radarAxes(b)]);
    expect(avg.punish).toBe(50);
    expect(avg.endgame).toBe(100);
    expect(avg.opening).toBeNull();
  });
});
