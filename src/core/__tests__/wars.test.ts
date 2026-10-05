import { describe, expect, it } from "vitest";
import { normalizeDatetime, splitPlayerName, warsTimeControl } from "../wars";
import { parseBoardSfen, positionKey, rookFile } from "../position";
import { Color } from "tsshogi";

describe("wars helpers", () => {
  it("段級位を分離する", () => {
    expect(splitPlayerName("taro 三段")).toEqual({ name: "taro", rank: "三段" });
    expect(splitPlayerName("hanako 10級")).toEqual({ name: "hanako", rank: "10級" });
    expect(splitPlayerName("plain")).toEqual({ name: "plain" });
    expect(splitPlayerName(undefined)).toEqual({ name: "" });
  });

  it("持ち時間区分を取り出す", () => {
    expect(warsTimeControl("将棋ウォーズ(10分)")).toBe("10分");
    expect(warsTimeControl("将棋ウォーズ（3分）")).toBe("3分");
    expect(warsTimeControl("将棋ウォーズ(10分切れ負け)")).toBe("10分");
    expect(warsTimeControl("将棋ウォーズ(10秒)")).toBe("10秒");
    expect(warsTimeControl("順位戦")).toBeUndefined();
  });

  it("日時を正規化する", () => {
    expect(normalizeDatetime("2024/06/17 10:05:15")).toBe("2024-06-17T10:05:15");
    expect(normalizeDatetime("2024/6/7")).toBe("2024-06-07T00:00:00");
    expect(normalizeDatetime("不明")).toBe("不明");
  });
});

describe("position helpers", () => {
  const sfen = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
  it("局面キーは手数を含まない", () => {
    expect(positionKey(sfen)).toBe("lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b -");
  });
  it("盤面を展開して飛車の筋を得る", () => {
    expect(parseBoardSfen(sfen.split(" ")[0]!)).toHaveLength(40);
    expect(rookFile(sfen, Color.BLACK)).toBe(2);
    expect(rookFile(sfen, Color.WHITE)).toBe(8);
    expect(rookFile("9/9/9/9/9/9/9/9/9 b -", Color.BLACK)).toBeNull();
  });
});
