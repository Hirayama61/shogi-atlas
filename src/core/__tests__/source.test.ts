import { describe, expect, it } from "vitest";
import { parseKifu } from "../parse";
import { SERVICE_LABEL, serviceFromQuery, serviceOf } from "../source";
import { QUEST_KIF_TIMEOUT, USI_SHIKEN_VS_FUNA, WARS_KIF } from "./fixtures";

const source = { kind: "paste" as const };

describe("serviceOf", () => {
  it("棋戦・場所から将棋ウォーズと判定する", () => {
    expect(serviceOf({ tournament: "将棋ウォーズ(10分)", tags: [] })).toBe("wars");
    expect(serviceOf({ place: "将棋ウォーズ", tags: [] })).toBe("wars");
  });

  it("棋戦から将棋クエストと判定する", () => {
    expect(serviceOf({ tournament: "Shogi Quest", tags: [] })).toBe("quest");
    expect(serviceOf({ place: "将棋クエスト", tags: [] })).toBe("quest");
  });

  it("棋戦が無くてもタグがあれば判定する (古いレコード)", () => {
    expect(serviceOf({ tags: ["将棋ウォーズ", "taro"] })).toBe("wars");
    expect(serviceOf({ tags: ["将棋クエスト"] })).toBe("quest");
  });

  it("どちらでもなければ other", () => {
    expect(serviceOf({ tags: [] })).toBe("other");
    expect(serviceOf({ tournament: "順位戦", place: "東京", tags: ["taro"] })).toBe("other");
    expect(SERVICE_LABEL.other).toBe("");
  });

  it("parseKifu の結果でも判定できる", async () => {
    expect(serviceOf(await parseKifu(WARS_KIF, { source }))).toBe("wars");
    expect(serviceOf(await parseKifu(QUEST_KIF_TIMEOUT, { source }))).toBe("quest");
    expect(serviceOf(await parseKifu(USI_SHIKEN_VS_FUNA, { source }))).toBe("other");
  });
});

describe("serviceFromQuery", () => {
  it("「ウォーズ」「クエスト」を含む入力をサービスに対応づける", () => {
    expect(serviceFromQuery("ウォーズ")).toBe("wars");
    expect(serviceFromQuery("将棋ウォーズ")).toBe("wars");
    expect(serviceFromQuery("wars")).toBe("wars");
    expect(serviceFromQuery("クエスト")).toBe("quest");
    expect(serviceFromQuery("shogi quest")).toBe("quest");
  });

  it("それ以外は null", () => {
    expect(serviceFromQuery("")).toBeNull();
    expect(serviceFromQuery("四間飛車")).toBeNull();
    expect(serviceFromQuery("taro")).toBeNull();
  });
});
