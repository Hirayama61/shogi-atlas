import { describe, expect, it } from "vitest";
import type { AnalysisRecord } from "../analysis";
import { firstCapturePly } from "../board";
import { castleMaturityAtFirstCapture, computeComboStats } from "../combo";
import { parseKifu } from "../parse";
import { USI_KAKUGAWARI, USI_LINE, USI_NO_CASTLE, USI_SHIKEN_VS_FUNA } from "./fixtures";

const source = { kind: "paste" as const };

/** 本美濃が完成してから ☖8六歩 ☗同歩 で最初の駒交換 (23 手目) */
const USI_SHIKEN_CAPTURE = `${USI_SHIKEN_VS_FUNA} 9g9f 8e8f 8g8f`;
/** 囲いを組まないまま ☗2四歩 ☖同歩 で最初の駒交換 (16 手目) */
const USI_NO_CASTLE_CAPTURE = `${USI_NO_CASTLE} 2f2e 9d9e 2e2d 2c2d`;

describe("firstCapturePly", () => {
  it("駒が初めて取られた手を返す", async () => {
    const kaku = await parseKifu(USI_KAKUGAWARI, { source });
    expect(firstCapturePly(kaku.positions)).toBe(8); // ☖7七角成
    const shiken = await parseKifu(USI_SHIKEN_CAPTURE, { source });
    expect(firstCapturePly(shiken.positions)).toBe(23);
  });

  it("駒交換が無ければ null", async () => {
    const g = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
    expect(firstCapturePly(g.positions)).toBeNull();
  });
});

describe("castleMaturityAtFirstCapture", () => {
  it("駒交換の直前に囲いが全部そろっていれば完成", async () => {
    const g = await parseKifu(USI_SHIKEN_CAPTURE, { source });
    expect(castleMaturityAtFirstCapture(g.positions, "black")).toEqual({
      maturity: "mature",
      ply: 23,
      castle: "本美濃",
    });
  });

  it("どの囲いにも当てはまらなければ未成熟", async () => {
    const g = await parseKifu(USI_NO_CASTLE_CAPTURE, { source });
    expect(castleMaturityAtFirstCapture(g.positions, "black")).toEqual({
      maturity: "immature",
      ply: 16,
      castle: null,
    });
    expect(castleMaturityAtFirstCapture(g.positions, "white").maturity).toBe("immature");
  });

  it("駒交換が無ければ noCapture", async () => {
    const g = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
    expect(castleMaturityAtFirstCapture(g.positions, "black").maturity).toBe("noCapture");
  });
});

describe("computeComboStats", () => {
  it("戦法 × 囲い、成熟度、相手の囲いを集計する", async () => {
    const a = await parseKifu(USI_SHIKEN_CAPTURE, { source });
    const b = await parseKifu(USI_NO_CASTLE_CAPTURE, { source });
    const c = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
    // 短すぎて戦法も囲いも判定できない対局
    const d = await parseKifu(USI_LINE, { source });
    Object.assign(a, { black: "taro", white: "jiro", result: "black" });
    Object.assign(b, { black: "taro", white: "saburo", result: "white" });
    Object.assign(c, { black: "taro", white: "shiro", result: "white" });
    Object.assign(d, { black: "goro", white: "taro", result: "black" });

    // a だけ解析済み: 先手の手は 1 手あたり 100cp ずつ損をする
    const plies = Array.from({ length: a.length + 1 }, (_, ply) => ({
      ply,
      cp: -100 * Math.ceil(ply / 2),
    }));
    const analysis: AnalysisRecord = {
      schema: 1,
      id: a.id,
      engine: { name: "test", depth: 1 },
      analyzedAt: "",
      game: { importedAt: a.importedAt, length: a.length },
      plies,
    };

    const s = computeComboStats([a, b, c, d], "taro", new Map([[a.id, analysis]]));
    const pick = (x: { name: string; games: number; wins: number; losses: number }) => [
      x.name,
      x.games,
      x.wins,
      x.losses,
    ];

    const shikenMino = s.openingCastle.find((x) => x.name === "ノーマル四間飛車 × 本美濃");
    expect(shikenMino).toMatchObject({
      games: 2,
      wins: 1,
      losses: 1,
      analyzed: 1,
      averageLoss: 100,
    });
    expect(s.openingCastle.reduce((n, x) => n + x.games, 0)).toBe(4);
    // 判定できない対局も落とさず「不明」で数える
    const unknown = s.openingCastle.find((x) => x.first === "不明");
    expect(unknown).toMatchObject({ games: 1, wins: 0, losses: 1, averageLoss: null });

    expect(s.maturity.map(pick).sort()).toEqual(
      [
        ["完成", 1, 1, 0],
        ["未成熟", 1, 0, 1],
        ["駒交換なし", 2, 0, 2],
      ].sort(),
    );

    expect(s.openingVsCastle.find((x) => x.name === "ノーマル四間飛車 × 舟囲い")).toMatchObject({
      games: 2,
      wins: 1,
      losses: 1,
    });
    expect(s.vsCastles.find((x) => x.name === "舟囲い")).toMatchObject({
      games: 2,
      wins: 1,
      losses: 1,
    });
    expect(s.vsCastles.reduce((n, x) => n + x.games, 0)).toBe(4);

    // 囲いごと・全体の平均損失は解析済みの a だけから求める
    expect(s.castles.find((x) => x.name === "本美濃")).toMatchObject({
      games: 2,
      analyzed: 1,
      averageLoss: 100,
    });
    expect(s.castles.reduce((n, x) => n + x.games, 0)).toBe(4);
    expect(s).toMatchObject({ analyzed: 1, averageLoss: 100 });
    // 解析が無ければ全体の平均損失は null
    expect(computeComboStats([a, b], "taro")).toMatchObject({ analyzed: 0, averageLoss: null });
  });

  it("古い解析は平均損失に使わない", async () => {
    const a = await parseKifu(USI_SHIKEN_CAPTURE, { source });
    Object.assign(a, { black: "taro", white: "jiro", result: "black" });
    const stale: AnalysisRecord = {
      schema: 1,
      id: a.id,
      engine: { name: "test", depth: 1 },
      analyzedAt: "",
      plies: [{ ply: 0, cp: 0 }],
    };
    const s = computeComboStats([a], "taro", new Map([[a.id, stale]]));
    expect(s.openingCastle[0]).toMatchObject({ analyzed: 0, averageLoss: null });
  });
});
