import { describe, expect, it } from "vitest";
import { canStartGame, canStartPly, estimateGameMs, worstGameMs } from "./budget";

const MIN = 60_000;
const s = (elapsedMin: number, budgetMin = 50, moveSec = 20, avgPlySec?: number) => ({
  elapsedMs: elapsedMin * MIN,
  budgetMs: budgetMin * MIN,
  moveTimeLimitMs: moveSec * 1000,
  ...(avgPlySec === undefined ? {} : { avgPlyMs: avgPlySec * 1000 }),
});

describe("worstGameMs", () => {
  it("局面数 (手数 + 1) × 1 局面の上限", () => {
    expect(worstGameMs(89, 20_000)).toBe(30 * MIN);
    expect(worstGameMs(89, 0)).toBe(Infinity);
  });
});

describe("estimateGameMs", () => {
  it("局面数 × 実測平均 × 安全係数 3。実測が無ければ 1 局面 2 秒とみなす", () => {
    // 99 手 = 100 局面 × 1 秒 × 3 = 5 分
    expect(estimateGameMs(s(0, 50, 20, 1), 99)).toBe(5 * MIN);
    // 99 手 = 100 局面 × 2 秒 × 3 = 10 分
    expect(estimateGameMs(s(0), 99)).toBe(10 * MIN);
  });

  it("1 局面の見積もりは MOVE_TIME_LIMIT で頭打ち", () => {
    expect(estimateGameMs(s(0, 50, 20, 10), 89)).toBe(30 * MIN);
    expect(estimateGameMs(s(0, 50, 0, 1), 89)).toBe(Infinity);
  });
});

describe("canStartGame", () => {
  it("残り 34 分・平均 1 秒/局面なら 100 手の対局を始める", () => {
    expect(canStartGame(s(16, 50, 20, 1), 100, 16)).toBe(true);
  });

  it("残り時間が 局面数 × 実測平均 × 安全係数 に足りなければ始めない", () => {
    // 99 手 = 100 局面 × 1 秒 × 3 = 5 分
    expect(canStartGame(s(45, 50, 20, 1), 99, 3)).toBe(true);
    expect(canStartGame(s(45.1, 50, 20, 1), 99, 3)).toBe(false);
    // 短い対局なら同じ残り時間でも始める
    expect(canStartGame(s(45.1, 50, 20, 1), 59, 3)).toBe(true);
    // 実測が遅ければ見積もりも延びる: 100 局面 × 4 秒 × 3 = 20 分
    expect(canStartGame(s(30, 50, 20, 4), 99, 3)).toBe(true);
    expect(canStartGame(s(31, 50, 20, 4), 99, 3)).toBe(false);
  });

  it("158 手の対局は予算 50 分の回なら最初でなくても始める", () => {
    expect(canStartGame(s(16, 50, 20, 1), 158, 16)).toBe(true);
    // 実測が無くても 159 局面 × 2 秒 × 3 ≒ 16 分
    expect(canStartGame(s(20), 158, 5)).toBe(true);
  });

  it("予算を使い切っていれば始めない", () => {
    expect(canStartGame(s(50), 1, 0)).toBe(false);
    expect(canStartGame(s(50, 50, 0), 1, 0)).toBe(false);
  });

  it("見積もりが予算全体でも収まらない長い対局は、その回の最初の 1 局に限って始める", () => {
    // 179 手 = 180 局面 × 20 秒 (頭打ち) = 60 分 > 50 分
    expect(canStartGame(s(0, 50, 20, 10), 179, 0)).toBe(true);
    expect(canStartGame(s(1, 50, 20, 10), 179, 1)).toBe(false);
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
