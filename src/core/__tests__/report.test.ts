import { describe, expect, it } from "vitest";
import {
  gameIdResolver,
  normalizeReport,
  parseInline,
  parseMarkdown,
  reportDigest,
  splitGameRefs,
  splitReport,
  type Block,
} from "../report";
import { fixtureReport, fixtureReportWithSummary } from "./fixtures";

const ID = "0123456789abcdef";

describe("parseMarkdown", () => {
  const blocks = parseMarkdown(fixtureReport("taro", ID));

  it("見出し・段落・区切り線を解く", () => {
    expect(blocks[0]).toEqual({ kind: "heading", level: 1, text: "taro 対策レポート" });
    expect(blocks[1]).toEqual({
      kind: "paragraph",
      text: "作成日 2026-10-05 (初回)。解析済み 2 局。",
    });
    expect(blocks.some((b) => b.kind === "hr")).toBe(true);
    expect(blocks.at(-1)).toEqual({ kind: "paragraph", text: "根拠: 架空のレポート" });
  });

  it("入れ子のリストと、空行をはさんだ番号つきリストを 1 つにまとめる", () => {
    const first = blocks[3] as Extract<Block, { kind: "list" }>;
    expect(first.items[0]!.text).toBe("四間飛車党。序盤は手堅く、終盤で崩れる。");
    expect(first.items[0]!.children[0]).toMatchObject({ kind: "list", ordered: false });
    const ordered = blocks.find((b) => b.kind === "list" && b.ordered) as Extract<
      Block,
      { kind: "list" }
    >;
    expect(ordered.items).toHaveLength(2);
    expect(ordered.start).toBe(1);
    expect(ordered.items[0]!.children).toEqual([
      {
        kind: "paragraph",
        text: "sfen `lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1`",
      },
    ]);
  });

  it("CRLF でも同じ", () => {
    expect(parseMarkdown(fixtureReport("taro", ID).replace(/\n/g, "\r\n"))).toEqual(blocks);
  });
});

describe("parseInline", () => {
  it("太字とコードだけを解き、HTML は文字のまま", () => {
    expect(parseInline("a **b** `c` <b>d</b>")).toEqual([
      { kind: "text", text: "a " },
      { kind: "strong", text: "b" },
      { kind: "text", text: " " },
      { kind: "code", text: "c" },
      { kind: "text", text: " <b>d</b>" },
    ]);
  });
});

describe("splitGameRefs", () => {
  const resolve = gameIdResolver([ID, "0123ffff00000000", "7786650000000000"]);

  it("ID と手数を参照にする", () => {
    expect(splitGameRefs(`${ID} 15手目 ▲1六歩`, resolve)).toEqual([
      { text: `${ID} 15手目`, ref: { gameId: ID, ply: 15 } },
      { text: " ▲1六歩" },
    ]);
  });

  it("先頭 6 桁でも一意なら引く。数字だけの ID も引ける", () => {
    expect(splitGameRefs("(778665: 負け、012345 21手目)", resolve)).toEqual([
      { text: "(" },
      { text: "778665", ref: { gameId: "7786650000000000" } },
      { text: ": 負け、" },
      { text: "012345 21手目", ref: { gameId: ID, ply: 21 } },
      { text: ")" },
    ]);
  });

  it("引けないもの、一意でないもの、長い数字の一部は参照にしない", () => {
    expect(splitGameRefs("abcdef 0123 123456789 0123fe", resolve)).toEqual([
      { text: "abcdef 0123 123456789 0123fe" },
    ]);
    expect(gameIdResolver([ID, "0123456789abcde0"])("0123456789")).toBeNull();
  });
});

describe("reportDigest", () => {
  it("第 1 節と、作戦の小見出しとその最初の項目", () => {
    const digest = reportDigest(parseMarkdown(fixtureReport("taro", ID)));
    const texts = digest.map((b) =>
      b.kind === "heading" ? b.text : b.kind === "list" ? b.items.map((i) => i.text) : b.kind,
    );
    expect(texts).toEqual([
      "1. 一言でいうとどういう相手か",
      ["四間飛車党。序盤は手堅く、終盤で崩れる。"],
      "2. こちらが採るべき作戦",
      "こちらが先手 (taro が後手)",
      ["居飛車穴熊にする。"],
      "こちらが後手 (taro が先手)",
      ["角交換を狙う。"],
    ]);
  });

  it("節の無い本文なら空", () => {
    expect(reportDigest(parseMarkdown("ただの文章"))).toEqual([]);
  });
});

describe("splitReport", () => {
  const listTexts = (blocks: Block[]) =>
    blocks.flatMap((b) => (b.kind === "list" ? b.items.map((i) => i.text) : []));

  it("「## 要点」の節があれば、その中身だけを要点にして全文からは除く", () => {
    const { digest, body } = splitReport(parseMarkdown(fixtureReportWithSummary("taro", ID)));
    expect(digest).toEqual([
      {
        kind: "list",
        ordered: false,
        start: 1,
        items: [
          { text: "終盤で崩れる四間飛車党。", children: [] },
          { text: "こちらが先手: 穴熊に組んで長期戦にする。", children: [] },
          { text: "こちらが後手: 角交換で乱戦にする。", children: [] },
        ],
      },
    ]);
    expect(body.some((b) => b.kind === "heading" && b.text === "要点")).toBe(false);
    expect(listTexts(body)).not.toContain("終盤で崩れる四間飛車党。");
    expect(body).toEqual(parseMarkdown(fixtureReport("taro", ID)));
  });

  it("番号つきの「## 0. 要点」も要点とみなす", () => {
    const md = "# x\n\n## 0. 要点\n\n- a\n\n## 1. 相手\n\n- b\n";
    const { digest, body } = splitReport(parseMarkdown(md));
    expect(listTexts(digest)).toEqual(["a"]);
    expect(listTexts(body)).toEqual(["b"]);
  });

  it("要点の節が無い古いレポートは従来の切り出しで、全文はそのまま", () => {
    const blocks = parseMarkdown(fixtureReport("taro", ID));
    expect(splitReport(blocks)).toEqual({ digest: reportDigest(blocks), body: blocks });
  });
});

describe("normalizeReport", () => {
  it("欠けた項目を補い、壊れたものは null", () => {
    expect(normalizeReport({ name: "a", markdown: "x" })).toEqual({
      name: "a",
      markdown: "x",
      hash: "",
      fetchedAt: "",
    });
    expect(normalizeReport({ name: 1 })).toBeNull();
    expect(normalizeReport(null)).toBeNull();
  });
});
