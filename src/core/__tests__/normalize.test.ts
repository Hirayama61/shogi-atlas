import { describe, expect, it } from "vitest";
import { PARSER_VERSION, normalizeGame, normalizeSummary } from "../normalize";
import { parseKifu } from "../parse";
import { WARS_KIF } from "./fixtures";

describe("normalize", () => {
  it("戦法名の無い古いレコードに既定値を補う", () => {
    const old = {
      schema: 1,
      id: "abc",
      source: { kind: "issue", issue: 1 },
      importedAt: "2026-01-01T00:00:00Z",
      format: "csa",
      raw: "V2.2",
      black: "a",
      white: "b",
      length: 10,
      result: "black",
      endReason: "resign",
      usi: "position startpos",
      positions: ["x"],
      opening: {
        black: "ibisha",
        white: "furibisha",
        shape: "taikokei",
        blackRookFile: null,
        whiteRookFile: 4,
      },
      tags: ["a"],
    };
    const g = normalizeGame(old);
    expect(g).not.toBeNull();
    expect(g!.parser).toBe(0);
    expect(g!.opening.blackOpening).toBe("不明");
    expect(g!.opening.whiteCastle).toBe("不明");
    expect(g!.opening.whiteRookFile).toBe(4);
    expect(g!.tags).toEqual(["a"]);
  });

  it("壊れた入力は null", () => {
    expect(normalizeSummary(null)).toBeNull();
    expect(normalizeSummary({})).toBeNull();
    expect(normalizeGame({ id: "x" })).toBeNull();
  });

  it("現在のパーサーの出力は変化しない", async () => {
    const g = await parseKifu(WARS_KIF, {
      source: { kind: "paste" },
      importedAt: "2026-01-01T00:00:00Z",
    });
    expect(g.parser).toBe(PARSER_VERSION);
    expect(normalizeGame(JSON.parse(JSON.stringify(g)))).toEqual(g);
  });
});
