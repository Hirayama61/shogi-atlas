import { describe, expect, it } from "vitest";
import { parseKifu } from "../parse";
import { shortOpeningLabel } from "../opening";
import {
  USI_AIGAKARI_LATE_KAKU,
  USI_ANAGUMA_VS_SHIKEN,
  USI_HAYAISHIDA,
  USI_KAKU_SHIKEN,
  USI_KAKUGAWARI,
  USI_MIGIGYOKU,
  USI_NO_CASTLE,
  USI_SHIKEN_LATE_KAKU,
  USI_SHIKEN_VS_FUNA,
  USI_YOKOFU,
} from "./fixtures";

const source = { kind: "paste" as const };

describe("classifyOpening", () => {
  it("四間飛車 + 本美濃 vs 居飛車 + 舟囲い", async () => {
    const g = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
    expect(g.length).toBe(20);
    expect(g.opening.shape).toBe("taikokei");
    expect(g.opening.blackOpening).toBe("四間飛車");
    expect(g.opening.blackCastle).toBe("本美濃");
    expect(g.opening.whiteOpening).toBe("居飛車");
    expect(g.opening.whiteCastle).toBe("舟囲い");
    expect(shortOpeningLabel(g.opening)).toBe("☗四間飛車");
  });

  it("角換わり", async () => {
    const g = await parseKifu(USI_KAKUGAWARI, { source });
    expect(g.length).toBe(14);
    expect(g.opening.shape).toBe("aiIbisha");
    expect(g.opening.blackOpening).toBe("角換わり");
    expect(g.opening.whiteOpening).toBe("角換わり");
    expect(shortOpeningLabel(g.opening)).toBe("角換わり");
  });

  it("仕掛けのあとの角交換では 角交換四間飛車 にしない", async () => {
    const g = await parseKifu(USI_SHIKEN_LATE_KAKU, { source });
    expect(g.length).toBe(26);
    expect(g.opening.blackOpening).toBe("四間飛車");
    expect(g.opening.whiteOpening).toBe("居飛車");
  });

  it("序盤に角交換してから振れば 角交換四間飛車", async () => {
    const g = await parseKifu(USI_KAKU_SHIKEN, { source });
    expect(g.length).toBe(18);
    expect(g.opening.blackOpening).toBe("角交換四間飛車");
    expect(shortOpeningLabel(g.opening)).toBe("☗角交換四間飛車");
  });

  it("相居飛車で仕掛けのあとに角交換しても 角換わり にしない", async () => {
    const g = await parseKifu(USI_AIGAKARI_LATE_KAKU, { source });
    expect(g.length).toBe(20);
    expect(g.opening.shape).toBe("aiIbisha");
    expect(g.opening.blackOpening).toBe("相掛かり");
    expect(g.opening.whiteOpening).toBe("相掛かり");
  });

  it("8 手目以内に 7五歩 の三間飛車は 早石田 (角交換の接頭辞は付けない)", async () => {
    const g = await parseKifu(USI_HAYAISHIDA, { source });
    expect(g.length).toBe(16);
    expect(g.opening.blackOpening).toBe("早石田");
    expect(shortOpeningLabel(g.opening)).toBe("☗早石田");
  });

  it("横歩取り", async () => {
    const g = await parseKifu(USI_YOKOFU, { source });
    expect(g.length).toBe(16);
    expect(g.opening.blackOpening).toBe("横歩取り");
    expect(g.opening.whiteOpening).toBe("横歩取り");
  });

  it("居飛車穴熊 vs 四間飛車 + 本美濃", async () => {
    const g = await parseKifu(USI_ANAGUMA_VS_SHIKEN, { source });
    expect(g.length).toBe(20);
    expect(g.opening.shape).toBe("taikokei");
    expect(g.opening.whiteOpening).toBe("四間飛車");
    expect(g.opening.whiteRookFile).toBe(4);
    expect(g.opening.whiteCastle).toBe("本美濃");
    expect(g.opening.blackOpening).toBe("居飛車穴熊");
    expect(g.opening.blackCastle).toBe("居飛車穴熊");
    expect(shortOpeningLabel(g.opening)).toBe("☖四間飛車");
  });

  it("右玉", async () => {
    const g = await parseKifu(USI_MIGIGYOKU, { source });
    expect(g.length).toBe(14);
    expect(g.opening.blackCastle).toBe("右玉");
    // ☖は 4二玉・3二金・5二金・6二銀で、どの囲いにも当てはまらない
    expect(g.opening.whiteCastle).toBe("6八玉型");
  });

  it("どの囲いにも当てはまらなければ玉の位置で表す", async () => {
    const g = await parseKifu(USI_NO_CASTLE, { source });
    expect(g.length).toBe(12);
    expect(g.opening.blackCastle).toBe("6八玉型");
    expect(g.opening.whiteCastle).toBe("居玉");
  });

  it("美濃の途中の形は 右玉 ではなく完成形の 本美濃 になる", async () => {
    const g = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
    expect(g.opening.blackCastle).toBe("本美濃");
  });
});
