import { describe, expect, it } from "vitest";
import { importRecord, parseKifu, splitKifuBlocks } from "../parse";
import {
  AI_IBISHA_KIF,
  QUEST_KIF_DISCONNECT,
  QUEST_KIF_TIMEOUT,
  USI_CHECK_NOT_MATE,
  USI_LINE,
  USI_MATE_NO_TERMINAL,
  WARS_CSA,
  WARS_KIF,
} from "./fixtures";

const source = { kind: "paste" as const };

describe("parseKifu", () => {
  it("将棋ウォーズ形式の KIF を読み込める", async () => {
    const g = await parseKifu(WARS_KIF, { source });
    expect(g.format).toBe("kif");
    expect(g.black).toBe("Sukonbu3");
    expect(g.blackRank).toBe("二段");
    expect(g.white).toBe("nemushi_");
    expect(g.whiteRank).toBe("1級");
    expect(g.startedAt).toBe("2024-06-17T10:05:15");
    expect(g.endedAt).toBe("2024-06-17T10:09:48");
    expect(g.timeControl).toBe("10分");
    expect(g.tags).toContain("将棋ウォーズ");
    expect(g.length).toBe(14);
    expect(g.result).toBe("white");
    expect(g.endReason).toBe("resign");
    expect(g.usi).toBe(
      "position startpos moves 7g7f 3c3d 6g6f 8c8d 2h6h 8d8e 8h7g 7a6b 5i4h 5a4b 4h3h 4b3b 3h2h 5c5d",
    );
    expect(g.positions).toHaveLength(15);
    expect(g.positions[0]).toBe("lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b -");
    expect(g.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("将棋ウォーズのアプリが出す CSA 形式を読み込める", async () => {
    const g = await parseKifu(WARS_CSA, { source });
    expect(g.format).toBe("csa");
    expect(g.black).toBe("doukeinari");
    expect(g.blackRank).toBe("5段");
    expect(g.white).toBe("maedahide");
    expect(g.tournament).toBe("将棋ウォーズ(10分切れ負け)");
    expect(g.timeControl).toBe("10分");
    expect(g.tags).toContain("将棋ウォーズ");
    expect(g.startedAt).toBe("2026-10-05T23:52:45");
    expect(g.length).toBe(12);
    // %TIME_UP は手番側 (先手) の時間切れなので後手の勝ち
    expect(g.result).toBe("white");
    expect(g.endReason).toBe("timeout");
    expect(g.opening.white).toBe("furibisha");
  });

  it("飛車の位置から対抗形を判定する", async () => {
    const g = await parseKifu(WARS_KIF, { source });
    expect(g.opening.black).toBe("furibisha");
    expect(g.opening.white).toBe("ibisha");
    expect(g.opening.shape).toBe("taikokei");
    expect(g.opening.blackRookFile).toBe(6);
  });

  it("相居飛車と詰みによる終局を判定する", async () => {
    const g = await parseKifu(AI_IBISHA_KIF, { source });
    expect(g.opening.shape).toBe("aiIbisha");
    // 「詰み」は手番側 (ここでは先手) が詰まされた状態なので後手の勝ち
    expect(g.result).toBe("white");
    expect(g.endReason).toBe("mate");
    expect(g.length).toBe(14);
  });

  it("将棋クエストの KIF を読み込める (レート、時間切れ)", async () => {
    const g = await parseKifu(QUEST_KIF_TIMEOUT, { source });
    expect(g.black).toBe("alice");
    expect(g.blackRating).toBe(1605);
    expect(g.blackRank).toBeUndefined();
    expect(g.white).toBe("bob");
    expect(g.whiteRating).toBe(1480);
    expect(g.tournament).toBe("Shogi Quest");
    expect(g.tags).toContain("将棋クエスト");
    expect(g.startedAt).toBeUndefined();
    expect(g.length).toBe(4);
    // 5 手目を指すはずだった先手の時間切れなので後手の勝ち
    expect(g.result).toBe("white");
    expect(g.endReason).toBe("timeout");
  });

  it("将棋クエストの接続切れは手番側の負け", async () => {
    const g = await parseKifu(QUEST_KIF_DISCONNECT, { source });
    expect(g.length).toBe(3);
    expect(g.result).toBe("black");
    expect(g.endReason).toBe("disconnect");
  });

  it("終局行が無くても最終局面が詰みなら詰みと判定する", async () => {
    const g = await parseKifu(USI_MATE_NO_TERMINAL, { source });
    expect(g.length).toBe(1);
    expect(g.result).toBe("black");
    expect(g.endReason).toBe("mate");
  });

  it("王手だけでは終局とみなさない", async () => {
    const g = await parseKifu(USI_CHECK_NOT_MATE, { source });
    expect(g.result).toBe("unknown");
    expect(g.endReason).toBe("unknown");
  });

  it("USI 文字列も読み込める", async () => {
    const g = await parseKifu(USI_LINE, { source, tags: ["test", "test", " "] });
    expect(g.format).toBe("usi");
    expect(g.length).toBe(6);
    expect(g.result).toBe("unknown");
    expect(g.opening.shape).toBe("unknown");
    expect(g.tags).toEqual(["test"]);
  });

  it("同じ棋譜からは同じ ID が得られる", async () => {
    const a = await parseKifu(WARS_KIF, { source });
    const b = await parseKifu(WARS_KIF.replace(/\n/g, "\r\n"), { source });
    expect(a.id).toBe(b.id);
  });

  it("空や意味のないテキストはエラーになる", () => {
    expect(() => importRecord("")).toThrow(/空/);
    expect(() => importRecord("こんにちは")).toThrow();
  });
});

describe("splitKifuBlocks", () => {
  it("--- 区切りで複数の棋譜に分ける", () => {
    const blocks = splitKifuBlocks(`${WARS_KIF}\n---\n${AI_IBISHA_KIF}`);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatch(/^先手：alice/);
  });
});
