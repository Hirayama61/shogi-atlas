import { describe, expect, it } from "vitest";
import { canStartGame, canStartPly, worstGameMs } from "./budget";

const MIN = 60_000;
const s = (elapsedMin: number, budgetMin = 50, moveSec = 20) => ({
  elapsedMs: elapsedMin * MIN,
  budgetMs: budgetMin * MIN,
  moveTimeLimitMs: moveSec * 1000,
});

describe("worstGameMs", () => {
  it("局面数 (手数 + 1) × 1 局面の上限", () => {
    expect(worstGameMs(89, 20_000)).toBe(30 * MIN);
    expect(worstGameMs(89, 0)).toBe(Infinity);
  });
});

describe("canStartGame", () => {
  it("残り時間が最悪見積もり以上なら始める", () => {
    // 89 手 = 90 局面 × 20 秒 = 30 分
    expect(canStartGame(s(20), 89, 3)).toBe(true);
  });

  it("残り時間が最悪見積もりに足りなければ始めない", () => {
    expect(canStartGame(s(21), 89, 3)).toBe(false);
    // 短い対局なら同じ残り時間でも始める
    expect(canStartGame(s(21), 59, 3)).toBe(true);
  });

  it("予算を使い切っていれば始めない", () => {
    expect(canStartGame(s(50), 1, 0)).toBe(false);
    expect(canStartGame(s(50, 50, 0), 1, 0)).toBe(false);
  });

  it("予算全体でも収まらない長い対局は、その回の最初の 1 局に限って始める", () => {
    // 179 手 = 180 局面 × 20 秒 = 60 分 > 50 分
    expect(canStartGame(s(0), 179, 0)).toBe(true);
    expect(canStartGame(s(1), 179, 1)).toBe(false);
  });

  it("1 局面の上限が無ければ見積もれないので予算内なら始める", () => {
    expect(canStartGame(s(49, 50, 0), 300, 5)).toBe(true);
  });
});

describe("canStartPly", () => {
  it("次の 1 局面で予算を超えるなら探索しない", () => {
    expect(
      canStartPly({ elapsedMs: 50 * MIN - 20_000, budgetMs: 50 * MIN, moveTimeLimitMs: 20_000 }),
    ).toBe(true);
    expect(
      canStartPly({ elapsedMs: 50 * MIN - 19_999, budgetMs: 50 * MIN, moveTimeLimitMs: 20_000 }),
    ).toBe(false);
    expect(canStartPly({ elapsedMs: 50 * MIN - 1, budgetMs: 50 * MIN, moveTimeLimitMs: 0 })).toBe(
      true,
    );
  });
});
