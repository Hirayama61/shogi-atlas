import { describe, expect, it } from "vitest";
import { normalizeSummary } from "../core/normalize";
import { describeGame, formatDate } from "./labels";

describe("labels", () => {
  it("戦法名が欠けた古いレコードでも undefined を表示しない", () => {
    const s = normalizeSummary({
      id: "x",
      black: "a",
      white: "b",
      length: 50,
      result: "white",
      endReason: "timeout",
      timeControl: "10分",
      opening: { shape: "taikokei", black: "ibisha", white: "furibisha" },
    })!;
    const text = describeGame(s);
    expect(text).not.toContain("undefined");
    expect(text).toBe("不明 · 50手 · 10分 · 後手勝ち(時間切れ)");
  });

  it("未知の結果や理由でも落ちない", () => {
    const s = normalizeSummary({ id: "x", result: "weird", endReason: "weird", opening: {} })!;
    expect(describeGame(s)).toBe("不明 · 0手 · 不明");
  });

  it("日付の整形", () => {
    expect(formatDate("2026-10-05T23:52:45")).toBe("2026-10-05 23:52");
    expect(formatDate(undefined)).toBe("日付不明");
  });
});
