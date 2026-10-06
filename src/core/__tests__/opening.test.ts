import { describe, expect, it } from "vitest";
import { parseKifu } from "../parse";
import { shortOpeningLabel } from "../opening";
import {
  USI_AIGAKARI_LATE_KAKU,
  USI_DIRECT_MUKAI,
  USI_GOKIGEN,
  USI_ISHIDA_HONGUMI,
  USI_ITTEZON,
  USI_KAKU_BOGIN,
  USI_KAKU_HAYAKURI,
  USI_KAKU_KOSHIKAKE,
  USI_NORMAL_SANKEN,
  USI_SAKATA_MUKAI,
  USI_SENTE_NAKABISHA,
  USI_ANAGUMA_VS_SHIKEN,
  USI_HAYAISHIDA,
  USI_KAKU_SHIKEN,
  USI_KAKUGAWARI,
  USI_MIGIGYOKU,
  USI_NO_CASTLE,
  USI_SHIKEN_LATE_KAKU,
  USI_SHIKEN_VS_FUNA,
  USI_YOKOFU,
  USI_NANAME_BOGIN,
  USI_45FU_HAYASHIKAKE,
  USI_TAIFURI_BOGIN,
  USI_FUNA_KYUSEN,
  USI_HENACHOKO,
  USI_ELMO_KYUSEN,
  USI_PONPON_KEI,
  USI_MILLENNIUM,
  USI_CHOSOKU,
} from "./fixtures";

const source = { kind: "paste" as const };

describe("classifyOpening", () => {
  it("ノーマル四間飛車 + 本美濃 vs 居飛車 + 舟囲い", async () => {
    const g = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
    expect(g.length).toBe(20);
    expect(g.opening.shape).toBe("taikokei");
    expect(g.opening.blackOpening).toBe("ノーマル四間飛車");
    expect(g.opening.blackCastle).toBe("本美濃");
    expect(g.opening.whiteOpening).toBe("居飛車");
    expect(g.opening.whiteCastle).toBe("舟囲い");
    expect(shortOpeningLabel(g.opening)).toBe("☗ノーマル四間飛車");
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
    expect(g.opening.blackOpening).toBe("ノーマル四間飛車");
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

  it("居飛車穴熊 vs ノーマル四間飛車 + 本美濃", async () => {
    const g = await parseKifu(USI_ANAGUMA_VS_SHIKEN, { source });
    expect(g.length).toBe(20);
    expect(g.opening.shape).toBe("taikokei");
    expect(g.opening.whiteOpening).toBe("ノーマル四間飛車");
    expect(g.opening.whiteRookFile).toBe(4);
    expect(g.opening.whiteCastle).toBe("本美濃");
    expect(g.opening.blackOpening).toBe("居飛車穴熊");
    expect(g.opening.blackCastle).toBe("居飛車穴熊");
    expect(shortOpeningLabel(g.opening)).toBe("☖ノーマル四間飛車");
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

  it.each([
    ["ゴキゲン中飛車", USI_GOKIGEN, "white", 14],
    ["先手中飛車", USI_SENTE_NAKABISHA, "black", 12],
    ["ノーマル三間飛車", USI_NORMAL_SANKEN, "black", 16],
    ["石田流本組", USI_ISHIDA_HONGUMI, "black", 18],
    ["ダイレクト向かい飛車", USI_DIRECT_MUKAI, "black", 14],
    ["阪田流向かい飛車", USI_SAKATA_MUKAI, "black", 14],
  ] as const)("振り飛車の細分化: %s", async (name, usi, side, length) => {
    const g = await parseKifu(usi, { source });
    expect(g.length).toBe(length);
    expect(g.opening.shape).toBe("taikokei");
    expect(side === "black" ? g.opening.blackOpening : g.opening.whiteOpening).toBe(name);
    expect(side === "black" ? g.opening.whiteOpening : g.opening.blackOpening).toBe("居飛車");
  });

  it.each([
    ["角換わり棒銀", USI_KAKU_BOGIN],
    ["角換わり早繰り銀", USI_KAKU_HAYAKURI],
    ["角換わり腰掛け銀", USI_KAKU_KOSHIKAKE],
  ] as const)("角換わりの中身: %s", async (name, usi) => {
    const g = await parseKifu(usi, { source });
    expect(g.length).toBe(20);
    expect(g.opening.shape).toBe("aiIbisha");
    expect(g.opening.blackOpening).toBe(name);
    expect(g.opening.whiteOpening).toBe("角換わり");
    expect(shortOpeningLabel(g.opening)).toBe(`${name} / 角換わり`);
  });

  it("一手損角換わり: 2二の角で 8八の角を直接取った側", async () => {
    const g = await parseKifu(USI_ITTEZON, { source });
    expect(g.length).toBe(14);
    expect(g.opening.shape).toBe("aiIbisha");
    expect(g.opening.whiteOpening).toBe("一手損角換わり");
    expect(g.opening.blackOpening).toBe("角換わり");
  });

  it.each([
    ["斜め棒銀", USI_NANAME_BOGIN, "ノーマル四間飛車"],
    ["4五歩早仕掛け", USI_45FU_HAYASHIKAKE, "ノーマル四間飛車"],
    ["対振り棒銀", USI_TAIFURI_BOGIN, "ノーマル四間飛車"],
    ["舟囲い急戦", USI_FUNA_KYUSEN, "ノーマル四間飛車"],
    ["へなちょこ急戦", USI_HENACHOKO, "ノーマル四間飛車"],
    ["エルモ急戦", USI_ELMO_KYUSEN, "ノーマル四間飛車"],
    ["ポンポン桂", USI_PONPON_KEI, "ノーマル四間飛車"],
    ["ミレニアム", USI_MILLENNIUM, "ノーマル四間飛車"],
    ["超速", USI_CHOSOKU, "ゴキゲン中飛車"],
  ] as const)("対抗形の居飛車側の細分化: %s", async (name, usi, furi) => {
    const g = await parseKifu(usi, { source });
    expect(g.opening.shape).toBe("taikokei");
    expect(g.opening.blackOpening).toBe(name);
    expect(g.opening.whiteOpening).toBe(furi);
    // 一覧の短い表示は今までどおり振り飛車側の名前
    expect(shortOpeningLabel(g.opening)).toBe(`☖${furi}`);
  });

  it("ミレニアム囲い", async () => {
    const g = await parseKifu(USI_MILLENNIUM, { source });
    expect(g.opening.blackCastle).toBe("ミレニアム囲い");
  });
});
