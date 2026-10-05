import { describe, expect, it } from "vitest";
import { parseIssueBody, playerFromTitle } from "./inbox";
import { WARS_KIF } from "../src/core/__tests__/fixtures";

describe("parseIssueBody", () => {
  it("Issue フォーム形式を分解する", () => {
    const body = `### 棋譜\n\n\`\`\`\n${WARS_KIF}\`\`\`\n\n### 出典URL\n\nhttps://example.com/x\n\n### タグ\n\n大会相手, ゆうちゅうばー\n\n### メモ\n\n_No response_\n`;
    const e = parseIssueBody(body, ["kifu", "要注目"]);
    expect(e.kifuBlocks).toHaveLength(1);
    expect(e.kifuBlocks[0]).toMatch(/^開始日時/);
    expect(e.url).toBe("https://example.com/x");
    expect(e.tags).toEqual(["大会相手", "ゆうちゅうばー", "要注目"]);
    expect(e.memo).toBeUndefined();
  });

  it("見出しなしのコメントは全体を棋譜として扱い、メモ行と URL 行を抜き出す", () => {
    const e = parseIssueBody(
      `メモ: 序盤で焦った\nurl: https://example.com/y\n${WARS_KIF}\n---\n${WARS_KIF}`,
    );
    expect(e.kifuBlocks).toHaveLength(2);
    expect(e.kifuBlocks[0]).toMatch(/^開始日時/);
    expect(e.memo).toBe("序盤で焦った");
    expect(e.url).toBe("https://example.com/y");
    expect(e.tags).toEqual([]);
  });

  it("棋譜がなければ空", () => {
    expect(parseIssueBody("### 棋譜\n\n_No response_\n").kifuBlocks).toEqual([]);
    expect(parseIssueBody("").kifuBlocks).toEqual([]);
  });

  it("棋譜に見えない文章は無視する", () => {
    expect(parseIssueBody("この人は早繰り銀が多い。次は対策を考える。").kifuBlocks).toEqual([]);
    expect(parseIssueBody(`ありがとう\n---\n${WARS_KIF}`).kifuBlocks).toHaveLength(1);
  });
});

describe("playerFromTitle", () => {
  it("接頭辞を外して対局者名にする", () => {
    expect(playerFromTitle("棋譜: Sukonbu3")).toBe("Sukonbu3");
    expect(playerFromTitle("nemushi_")).toBe("nemushi_");
    expect(playerFromTitle("棋譜: ")).toBeUndefined();
  });
});
