import { describe, expect, it } from "vitest";
import { Position } from "tsshogi";
import { formatRating, isShogiQuest, splitRating } from "../quest";
import { hasLegalMove, isCheckmated } from "../mate";

describe("quest helpers", () => {
  it("レートを分離する", () => {
    expect(splitRating("TechnoPopBakery(1605)")).toEqual({ name: "TechnoPopBakery", rating: 1605 });
    expect(splitRating("name_pu_315_yo (800)")).toEqual({ name: "name_pu_315_yo", rating: 800 });
    expect(splitRating("taro（1234）")).toEqual({ name: "taro", rating: 1234 });
    expect(splitRating("plain")).toEqual({ name: "plain" });
    expect(splitRating("taro 三段")).toEqual({ name: "taro 三段" });
    expect(splitRating(undefined)).toEqual({ name: "" });
  });

  it("将棋クエストの棋譜かどうか", () => {
    expect(isShogiQuest("Shogi Quest", undefined)).toBe(true);
    expect(isShogiQuest(undefined, "将棋クエスト")).toBe(true);
    expect(isShogiQuest("将棋ウォーズ(10分)", undefined)).toBe(false);
  });

  it("レートの表示", () => {
    expect(formatRating(1605)).toBe("R1605");
    expect(formatRating(undefined)).toBeUndefined();
  });
});

describe("mate", () => {
  const pos = (sfen: string) => Position.newBySFEN(sfen)!;

  it("詰みを判定する", () => {
    // 後手玉５一、先手の金５二 (５三の歩で支え)。後手の手番で逃げ場なし
    expect(isCheckmated(pos("4k4/4G4/4P4/9/9/9/9/9/4K4 w - 1"))).toBe(true);
  });

  it("王手でも逃げられれば詰みではない", () => {
    expect(isCheckmated(pos("4k4/4G4/9/9/9/9/9/9/4K4 w - 1"))).toBe(false);
  });

  it("合駒や持ち駒の打ちも合法手として数える", () => {
    // 飛車の王手に持ち駒の歩で合駒できる
    const p = pos("4k4/9/9/9/4R4/9/9/9/4K4 w p 1");
    expect(p.checked).toBe(true);
    expect(hasLegalMove(p)).toBe(true);
    expect(isCheckmated(p)).toBe(false);
  });

  it("王手がかかっていなければ詰みではない", () => {
    expect(isCheckmated(pos("4k4/9/9/9/9/9/9/9/4K4 b - 1"))).toBe(false);
  });
});
