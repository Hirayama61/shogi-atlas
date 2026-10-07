import { describe, expect, it } from "vitest";
import { parseKifu } from "../parse";
import { computePlayerStats } from "../stats";
import {
  computeOpeningDetail,
  computeStyleQuadrants,
  matchesStyle,
  quadrantOf,
  styleQuadrantOf,
} from "../styles";
import { USI_FUNA_KYUSEN, USI_KAKUGAWARI, USI_NO_CASTLE, USI_SHIKEN_VS_FUNA } from "./fixtures";

const source = { kind: "paste" as const };

async function games() {
  // taro:
  // a 先手 ノーマル四間飛車 vs 居飛車 (振り飛車 × 居飛車) 勝ち
  // b 後手 居飛車 vs ノーマル四間飛車 (居飛車 × 振り飛車) 勝ち
  // c 先手 舟囲い急戦 vs ノーマル四間飛車 (居飛車 × 振り飛車) 負け
  // d 先手 角換わり (相居飛車) 負け
  // e 後手 相振り飛車を模す 勝ち
  // f 先手 戦型不明 引き分け
  const a = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
  const b = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
  const c = await parseKifu(USI_FUNA_KYUSEN, { source });
  const d = await parseKifu(USI_KAKUGAWARI, { source });
  const e = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
  const f = await parseKifu(USI_NO_CASTLE, { source });
  Object.assign(a, { black: "taro", white: "jiro", result: "black" });
  Object.assign(b, { id: "bbbb", black: "jiro", white: "taro", result: "white" });
  Object.assign(c, { black: "taro", white: "saburo", result: "white" });
  Object.assign(d, { black: "taro", white: "shiro", result: "white" });
  Object.assign(e, { id: "eeee", black: "goro", white: "taro", result: "white" });
  e.opening = { ...e.opening, white: "furibisha", whiteOpening: "向かい飛車" };
  Object.assign(f, { black: "taro", white: "rokuro", result: "draw" });
  f.opening = { ...f.opening, white: "unknown", whiteOpening: "不明" };
  return [a, b, c, d, e, f] as const;
}

describe("styles (4 区分)", () => {
  it("本人の戦型 × 相手の戦型で振り分ける", () => {
    expect(quadrantOf("ibisha", "ibisha")).toBe("aiIbisha");
    expect(quadrantOf("ibisha", "furibisha")).toBe("ibishaVsFuri");
    expect(quadrantOf("furibisha", "ibisha")).toBe("furiVsIbisha");
    expect(quadrantOf("furibisha", "furibisha")).toBe("aiFuribisha");
    expect(quadrantOf("unknown", "ibisha")).toBe("unknown");
    expect(quadrantOf("ibisha", "unknown")).toBe("unknown");
  });

  it("フィクスチャの対局 (居飛車・振り飛車の両方、先後とも) を 4 区分と不明に振り分け、合計が全対局数に一致する", async () => {
    const all = await games();
    const [a, b, c, d, e, f] = all;
    expect(all.map((g) => styleQuadrantOf(g, "taro"))).toEqual([
      "furiVsIbisha",
      "ibishaVsFuri",
      "ibishaVsFuri",
      "aiIbisha",
      "aiFuribisha",
      "unknown",
    ]);
    expect(styleQuadrantOf(a, "nobody")).toBeNull();

    const q = computeStyleQuadrants([...all], "taro");
    expect(q.map((x) => [x.quadrant, x.games, x.wins, x.losses])).toEqual([
      ["aiIbisha", 1, 0, 1],
      ["ibishaVsFuri", 2, 1, 1],
      ["furiVsIbisha", 1, 1, 0],
      ["aiFuribisha", 1, 1, 0],
      ["unknown", 1, 0, 0],
    ]);
    expect(q.reduce((n, x) => n + x.games, 0)).toBe(computePlayerStats([...all], "taro").games);
    // 先後の内訳
    const vsFuri = q[1]!;
    expect(vsFuri.bySide).toEqual({
      black: { games: 1, wins: 0, losses: 1 },
      white: { games: 1, wins: 1, losses: 0 },
    });
    expect(vsFuri.openings.map((o) => o.name).sort()).toEqual(
      [b.opening.whiteOpening, c.opening.blackOpening].sort(),
    );
    expect(vsFuri.vsOpenings).toEqual([{ name: "ノーマル四間飛車", games: 2, wins: 1, losses: 1 }]);
    expect(matchesStyle(d, "taro", "aiIbisha")).toBe(true);
    expect(matchesStyle(e, "taro", "aiFuribisha", "opponent", e.opening.blackOpening)).toBe(true);
    expect(matchesStyle(f, "taro", "aiIbisha")).toBe(false);
  });

  it("4 区分は対局が無くても出し、不明は対局があるときだけ出す", async () => {
    const [a] = await games();
    expect(computeStyleQuadrants([a], "taro").map((x) => [x.quadrant, x.games])).toEqual([
      ["aiIbisha", 0],
      ["ibishaVsFuri", 0],
      ["furiVsIbisha", 1],
      ["aiFuribisha", 0],
    ]);
  });

  it("戦法の詳細: 囲いと相手の戦法 (相手の戦法で見るときは本人の応手) の内訳", async () => {
    const all = await games();
    const [, b, c] = all;
    const self = computeOpeningDetail([...all], "taro", "ibishaVsFuri", "self", "舟囲い急戦");
    expect(self).toMatchObject({ games: 1, wins: 0, losses: 1, gameIds: [c.id] });
    expect(self.castles.map((x) => x.name)).toEqual([c.opening.blackCastle]);
    expect(self.counter.map((x) => x.name)).toEqual(["ノーマル四間飛車"]);

    const opp = computeOpeningDetail(
      [...all],
      "taro",
      "ibishaVsFuri",
      "opponent",
      "ノーマル四間飛車",
    );
    expect(opp).toMatchObject({ games: 2, wins: 1, losses: 1 });
    expect(opp.gameIds).toEqual([b.id, c.id].sort());
    expect(opp.counter.map((x) => x.name).sort()).toEqual(
      [b.opening.whiteOpening, c.opening.blackOpening].sort(),
    );
    expect(opp.castles.reduce((n, x) => n + x.games, 0)).toBe(2);
  });
});
