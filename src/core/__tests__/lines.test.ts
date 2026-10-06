import { describe, expect, it } from "vitest";
import { findRepeatedLines, straightFrom, trunkOf } from "../lines";
import { parseKifu } from "../parse";
import { USI_KAKUGAWARI, USI_SHIKEN_VS_FUNA } from "./fixtures";

const source = { kind: "paste" as const };

async function games() {
  // 18 手目まで同じ。19 手目で ▲1六歩 (a, c) と ▲9六歩 (b, e) に分かれ、20 手目はどれも 1 局ずつ
  const a = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
  const b = await parseKifu(USI_SHIKEN_VS_FUNA.replace("1g1f 1c1d", "9g9f 9c9d"), { source });
  const c = await parseKifu(USI_SHIKEN_VS_FUNA.replace("1g1f 1c1d", "1g1f 9c9d"), { source });
  const e = await parseKifu(USI_SHIKEN_VS_FUNA.replace("1g1f 1c1d", "9g9f 1c1d"), { source });
  // 本人が指していない対局と、1 局しかない手順
  const other = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
  const lone = await parseKifu(USI_KAKUGAWARI, { source });
  Object.assign(a, { id: "a", black: "taro", white: "jiro", result: "black" });
  Object.assign(b, { id: "b", black: "taro", white: "saburo", result: "white" });
  Object.assign(c, { id: "c", black: "taro", white: "shiro", result: "black" });
  Object.assign(e, { id: "e", black: "taro", white: "goro", result: "white" });
  Object.assign(other, { id: "x", black: "hanako", white: "jiro", result: "black" });
  Object.assign(lone, { id: "k", black: "taro", white: "jiro", result: "black" });
  return [a, b, c, e, other, lone];
}

describe("findRepeatedLines", () => {
  it("幹の手順と局数、分岐の手と局数を返す", async () => {
    const roots = findRepeatedLines(await games(), "taro");
    expect(roots).toHaveLength(1);
    const root = roots[0]!;
    expect(root.ply).toBe(0);
    expect(root.gameIds).toHaveLength(5);

    // 1 手目 ▲7六歩 は 5 局 (角換わりも 7六歩)
    const trunk = trunkOf(root);
    expect(trunk[0]).toMatchObject({ ply: 1, label: "▲7六歩", usi: "7g7f" });
    expect(trunk[0]!.gameIds).toHaveLength(5);
    // 角換わりは 3 手目 ▲2六歩 で外れる
    expect(trunk[2]!.label).toBe("▲6六歩");
    expect(trunk[2]!.gameIds.sort()).toEqual(["a", "b", "c", "e"]);
    // 19 手目まで (20 手目はどれも 1 局なので出ない)
    expect(trunk).toHaveLength(19);
    expect(trunk[17]).toMatchObject({ ply: 18, label: "△5四歩", wins: 2 });

    // 18 手目の後で ▲1六歩 (2 局) / ▲9六歩 (2 局) に分かれる
    const fork = trunk[17]!;
    expect(fork.children.map((n) => [n.label, n.gameIds.sort(), n.wins])).toEqual([
      ["▲1六歩", ["a", "c"], 2],
      ["▲9六歩", ["b", "e"], 0],
    ]);
    expect(fork.children.every((n) => n.children.length === 0)).toBe(true);
  });

  it("1 本道は分岐のところまでまとめてたどれる", async () => {
    const root = findRepeatedLines(await games(), "taro")[0]!;
    const first = straightFrom(root.children[0]!);
    // 角換わりは 3 手目で外れるが 1 局だけなので分岐にならず、18 手目まで 1 本道
    expect(first).toHaveLength(18);
    expect(first.map((n) => n.label).slice(0, 3)).toEqual(["▲7六歩", "△8四歩", "▲6六歩"]);
    expect(first.map((n) => n.gameIds.length).slice(0, 3)).toEqual([5, 5, 4]);
    const last = first[first.length - 1]!;
    expect(last.children.map((n) => [n.label, n.gameIds.length])).toEqual([
      ["▲1六歩", 2],
      ["▲9六歩", 2],
    ]);
  });

  it("2 局以上が通らない手順は出さない", async () => {
    const [a, , , , , lone] = await games();
    expect(findRepeatedLines([a!, lone!], "taro")[0]?.children.map((n) => n.label)).toEqual([
      "▲7六歩",
    ]);
    expect(findRepeatedLines([a!], "taro")).toEqual([]);
  });
});
