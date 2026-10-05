import { describe, expect, it } from "vitest";
import { parseIssueBody } from "./inbox";
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

  it("見出しなしの本文は全体を棋譜として扱う", () => {
    const e = parseIssueBody(`${WARS_KIF}\n---\n${WARS_KIF}`);
    expect(e.kifuBlocks).toHaveLength(2);
    expect(e.tags).toEqual([]);
  });

  it("棋譜がなければ空", () => {
    expect(parseIssueBody("### 棋譜\n\n_No response_\n").kifuBlocks).toEqual([]);
  });
});
