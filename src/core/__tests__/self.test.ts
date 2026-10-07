import { describe, expect, it } from "vitest";
import { parseKifu } from "../parse";
import { computePortfolio } from "../portfolio";
import { applySelf, maskSelfInKifu, normalizeSelfIds, SELF_NAME } from "../self";
import { computePlayerStats, listPlayers, trackedSide } from "../stats";
import { USI_ANAGUMA_VS_SHIKEN, USI_SHIKEN_VS_FUNA, WARS_KIF } from "./fixtures";

const source = { kind: "paste" as const };
const SELF = new Set(["me_wars", "me_quest"]);

/** 自分の 2 ID の対局と、登録した相手 (rival) と自分の対局 */
async function games() {
  const a = await parseKifu(USI_SHIKEN_VS_FUNA, { source, tags: ["me_wars", "自分"] });
  const b = await parseKifu(USI_SHIKEN_VS_FUNA.replace("1g1f 1c1d", "9g9f 9c9d"), {
    source,
    tags: ["me_quest", "自分"],
  });
  const c = await parseKifu(USI_ANAGUMA_VS_SHIKEN, { source, tags: ["rival"] });
  Object.assign(a, { black: "me_wars", white: "x1", result: "black", blackRank: "二段" });
  Object.assign(b, { black: "me_quest", white: "x2", result: "white", blackRating: 1500 });
  Object.assign(c, { black: "rival", white: "me_wars", result: "white" });
  return [a, b, c];
}

describe("self", () => {
  it("normalizeSelfIds: 文字列だけを重複なく並べる", () => {
    expect(normalizeSelfIds(["b", " a ", "b", 1, "", null])).toEqual(["a", "b"]);
    expect(normalizeSelfIds(undefined)).toEqual([]);
  });

  it("applySelf: 自分の ID を「自分」にし、タグにも足す。該当しなければ同じオブジェクト", async () => {
    const [a, , c] = await games();
    const x = applySelf(a!, SELF);
    expect(x.black).toBe(SELF_NAME);
    expect(x.tags).not.toContain("me_wars");
    expect(x.tags).toContain(SELF_NAME);
    expect(x.raw).not.toContain("me_wars");
    // 元のレコードは書き換えない
    expect(a!.black).toBe("me_wars");
    // 相手の Issue 経由 (タグに自分が無い) でも自分として数える
    const y = applySelf(c!, SELF);
    expect(y.white).toBe(SELF_NAME);
    expect(y.tags).toEqual(["rival", SELF_NAME]);
    const other = { black: "p", white: "q", tags: ["p"] };
    expect(applySelf(other, SELF)).toBe(other);
    expect(applySelf(a!, new Set())).toBe(a);
  });

  it("maskSelfInKifu: 対局者名の行だけ置き換え、段級位は残す", () => {
    const kif = WARS_KIF.replace("Sukonbu3", "me_wars");
    const masked = maskSelfInKifu(kif, SELF);
    expect(masked).not.toContain("me_wars");
    expect(masked).toContain("先手：自分 二段");
    expect(masked).toContain("後手：nemushi_ 1級");
    expect(maskSelfInKifu("N+me_quest\nN-y\n", SELF)).toBe("N+自分\nN-y\n");
  });

  it("2 つの ID を 1 人として数え、局数・勝敗・戦法・ポートフォリオを合算する", async () => {
    const all = (await games()).map((g) => applySelf(g, SELF));
    const players = listPlayers(all);
    const me = players.find((p) => p.name === SELF_NAME)!;
    expect(players[0]!.name).toBe(SELF_NAME);
    expect(me.tracked).toBe(true);
    expect(me.games).toBe(3);
    expect(me.wins).toBe(2);
    expect(me.losses).toBe(1);
    expect(players.some((p) => SELF.has(p.name))).toBe(false);

    const s = computePlayerStats(all, SELF_NAME);
    expect(s.games).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.openings.reduce((n, b) => n + b.games, 0)).toBe(3);
    expect(s.commonPositions.length).toBeGreaterThan(0);
    expect(computePortfolio(all, SELF_NAME).reduce((n, g) => n + g.games, 0)).toBe(3);
  });

  it("自分と登録した相手の対局: 相手の集計とビューアの手前側は変わらない", async () => {
    const raw = await games();
    const before = computePlayerStats(raw, "rival");
    const after = computePlayerStats(
      raw.map((g) => applySelf(g, SELF)),
      "rival",
    );
    expect(after).toEqual(before);
    const c = applySelf(raw[2]!, SELF);
    expect(trackedSide(raw[2]!)).toBe("black");
    expect(trackedSide(c)).toBe("black");
    // 自分の対局 (相手は未登録) なら自分が手前
    expect(trackedSide(applySelf(raw[0]!, SELF))).toBe("black");
  });
});
