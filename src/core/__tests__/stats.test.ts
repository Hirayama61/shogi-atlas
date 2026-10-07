import { describe, expect, it } from "vitest";
import { parseKifu } from "../parse";
import { computePlayerStats, listPlayers, outcomeFor, trackedSide, viewerSide } from "../stats";
import { USI_ANAGUMA_VS_SHIKEN, USI_SHIKEN_VS_FUNA } from "./fixtures";

const source = { kind: "paste" as const };

describe("stats", () => {
  it("outcomeFor", () => {
    expect(outcomeFor("black", "black")).toBe("win");
    expect(outcomeFor("black", "white")).toBe("loss");
    expect(outcomeFor("draw", "white")).toBe("draw");
    expect(outcomeFor("unknown", "white")).toBe("unknown");
  });

  it("trackedSide: タグに名前がある側が本人。両方か無ければ null", () => {
    expect(trackedSide({ black: "a", white: "b", tags: ["a"] })).toBe("black");
    expect(trackedSide({ black: "a", white: "b", tags: ["b", "大会相手"] })).toBe("white");
    expect(trackedSide({ black: "a", white: "b", tags: ["a", "b"] })).toBeNull();
    expect(trackedSide({ black: "a", white: "b", tags: [] })).toBeNull();
  });

  it("viewerSide: 開いた元の対局者 → 自分 → trackedSide の順で手前を決める", () => {
    const g = { black: "rival", white: "自分", tags: ["rival", "自分"] };
    expect(viewerSide(g)).toBe("white");
    expect(viewerSide(g, "自分")).toBe("white");
    expect(viewerSide(g, "rival")).toBe("black");
    expect(viewerSide(g, "other")).toBe("white");
    expect(viewerSide({ black: "a", white: "b", tags: ["b"] })).toBe("white");
    expect(viewerSide({ black: "a", white: "b", tags: ["b"] }, "a")).toBe("black");
    expect(viewerSide({ black: "a", white: "b", tags: [] })).toBeNull();
  });

  it("対局者の成績と分岐点をまとめる", async () => {
    // 同じ手順を 2 局 (1 局は途中で分岐) 用意する
    const a = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
    const bUsi = USI_SHIKEN_VS_FUNA.replace("1g1f 1c1d", "9g9f 9c9d");
    const b = await parseKifu(bUsi, { source });
    const c = await parseKifu(USI_ANAGUMA_VS_SHIKEN, { source });
    // 対局者名と結果を上書き
    Object.assign(a, { black: "taro", white: "jiro", result: "black" });
    Object.assign(b, { black: "taro", white: "saburo", result: "white" });
    Object.assign(c, { black: "hanako", white: "taro", result: "white" });

    const s = computePlayerStats([a, b, c], "taro");
    expect(s.games).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.asBlack).toBe(2);
    expect(s.asWhite).toBe(1);
    expect(s.bySide).toEqual({
      black: { games: 2, wins: 1, losses: 1 },
      white: { games: 1, wins: 1, losses: 0 },
    });
    expect(s.openings.map((o) => [o.name, o.games, o.wins])).toEqual([["ノーマル四間飛車", 3, 2]]);
    expect(s.castles[0]?.name).toBe("本美濃");
    expect(s.vsOpenings.map((o) => o.name).sort()).toEqual(["居飛車", "居飛車穴熊"]);

    // a と b は 18 手目まで同じで 19 手目から分かれる (c とは序盤数手しか共通しないので除外される)
    expect(s.commonPositions).toHaveLength(1);
    expect(s.commonPositions[0]?.ply).toBe(18);
    expect(s.commonPositions[0]?.gameIds.sort()).toEqual([a.id, b.id].sort());

    const players = listPlayers([a, b, c]);
    expect(players[0]?.name).toBe("taro");
    expect(players[0]?.games).toBe(3);
    expect(players.map((p) => p.name)).toEqual(["taro", "hanako", "jiro", "saburo"]);
  });
});
