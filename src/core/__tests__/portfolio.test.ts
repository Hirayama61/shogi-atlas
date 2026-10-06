import { describe, expect, it } from "vitest";
import { parseKifu } from "../parse";
import { computePortfolio, matchesPortfolio, portfolioCommonPositions } from "../portfolio";
import { USI_ANAGUMA_VS_SHIKEN, USI_NO_CASTLE, USI_SHIKEN_VS_FUNA } from "./fixtures";

const source = { kind: "paste" as const };

async function games() {
  // taro: 先手でノーマル四間飛車 (相手居飛車) を 2 局 (19 手目から分岐)、後手でノーマル四間飛車 (相手居飛車穴熊)、先手で判定不明
  const a = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
  const b = await parseKifu(USI_SHIKEN_VS_FUNA.replace("1g1f 1c1d", "9g9f 9c9d"), { source });
  const c = await parseKifu(USI_ANAGUMA_VS_SHIKEN, { source });
  const d = await parseKifu(USI_NO_CASTLE, { source });
  Object.assign(a, { black: "taro", white: "jiro", result: "black" });
  Object.assign(b, { black: "taro", white: "saburo", result: "white" });
  Object.assign(c, { black: "hanako", white: "taro", result: "white" });
  Object.assign(d, { black: "taro", white: "shiro", result: "black" });
  // 判定できなかった対局を模す (本人の戦法・囲い、相手の戦型がすべて不明)
  d.opening = {
    ...d.opening,
    blackOpening: "不明",
    blackCastle: "不明",
    white: "unknown",
    whiteOpening: "不明",
  };
  return { a, b, c, d };
}

describe("portfolio", () => {
  it("先後 × 相手の戦型 → 本人の戦法 × 囲い を局数・勝敗つきでまとめる", async () => {
    const { a, b, c, d } = await games();
    const p = computePortfolio([a, b, c, d], "taro");
    expect(p.map((g) => [g.side, g.vsStyle, g.games, g.wins, g.losses])).toEqual([
      ["black", "ibisha", 2, 1, 1],
      ["black", "unknown", 1, 1, 0],
      ["white", "ibisha", 1, 1, 0],
    ]);
    const black = p[0]!;
    expect(black.opponents[0]?.vsOpening).toBe("居飛車");
    const rows = black.opponents.flatMap((o) =>
      o.responses.map((r) => [o.vsOpening, r.opening, r.castle, r.games, r.wins, r.losses]),
    );
    expect(rows).toContainEqual(["居飛車", "ノーマル四間飛車", "本美濃", 2, 1, 1]);
    expect(p[2]?.opponents[0]?.vsOpening).toBe("居飛車穴熊");
    expect(p[2]?.opponents[0]?.responses[0]?.gameIds).toEqual([c.id]);
  });

  it("戦法・囲いが不明の対局も「不明」として数える", async () => {
    const { a, b, c, d } = await games();
    const p = computePortfolio([a, b, c, d], "taro");
    const total = p.reduce((n, g) => n + g.games, 0);
    expect(total).toBe(4);
    const responses = p.flatMap((g) => g.opponents.flatMap((o) => o.responses));
    const unknown = p.find((g) => g.vsStyle === "unknown");
    expect(unknown?.opponents[0]?.vsOpening).toBe("不明");
    expect(unknown?.opponents[0]?.responses[0]).toMatchObject({
      opening: "不明",
      castle: "不明",
      gameIds: [d.id],
    });
    expect(responses.reduce((n, r) => n + r.games, 0)).toBe(4);
  });

  it("条件に当てはまる対局だけで分岐点を出す", async () => {
    const { a, b, c, d } = await games();
    const all = [a, b, c, d];
    const cond = { side: "black" as const, vsStyle: "ibisha" as const, vsOpening: "居飛車" };
    expect(all.filter((g) => matchesPortfolio(g, "taro", cond)).map((g) => g.id)).toContain(a.id);
    const branches = portfolioCommonPositions(all, "taro", cond);
    expect(branches[0]?.ply).toBe(18);
    expect(branches[0]?.gameIds).toEqual([a.id, b.id].sort());
    // 後手の条件では a, b が入らないので分岐点は無い
    expect(portfolioCommonPositions(all, "taro", { side: "white", vsStyle: "ibisha" })).toEqual([]);
    // 応手まで指定しても絞れる
    expect(
      portfolioCommonPositions(all, "taro", {
        ...cond,
        opening: "ノーマル四間飛車",
        castle: "不明",
      }),
    ).toEqual([]);
  });
});
