import { Position } from "tsshogi";
import { describe, expect, it } from "vitest";
import {
  attackStep,
  checkMoves,
  judgeTsumero,
  legalMoves,
  nonDefendingReply,
  passSfen,
  playMove,
  solveEscape,
  solveMate,
} from "../tsume";
import { SFEN_MATE_1, SFEN_MATE_3, SFEN_MATE_5, SFEN_NO_MATE, SFEN_TSUMERO } from "./fixtures";

describe("legalMoves", () => {
  it("平手の初期局面の合法手は 30 手", () => {
    const pos = Position.newBySFEN(
      "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
    )!;
    expect(legalMoves(pos)).toHaveLength(30);
  });

  it("成り・不成を両方数え、行き所の無い不成と二歩・打ち歩詰めは除く", () => {
    // ☗歩 2 三 → 2 二 は成りも不成も指せる。1 段目は成りだけ
    const pos = Position.newBySFEN("8k/9/7P1/9/9/9/9/9/K8 b P 1")!;
    const usis = legalMoves(pos).map((m) => m.usi);
    expect(usis).toContain("2c2b");
    expect(usis).toContain("2c2b+");
    // 2 筋には歩があるので打てない (二歩)
    expect(usis.filter((u) => u.startsWith("P*2"))).toEqual([]);
    // 1 段目には打てない
    expect(usis).not.toContain("P*3a");
  });

  it("王手は王手になる手だけ", () => {
    const pos = Position.newBySFEN(SFEN_MATE_1)!;
    const checks = checkMoves(pos).map((m) => m.usi);
    expect(checks).toContain("G*5b");
    expect(checks.every((u) => u.startsWith("G*") || u.startsWith("5c"))).toBe(true);
  });
});

describe("solveMate", () => {
  it("1 手詰・3 手詰・5 手詰の最短手順を返す", () => {
    expect(solveMate(SFEN_MATE_1)).toEqual({ mate: true, moves: ["G*5b"] });
    expect(solveMate(SFEN_MATE_3)).toEqual({ mate: true, moves: ["B*3c", "1a2a", "G*2b"] });
    expect(solveMate(SFEN_MATE_5)).toEqual({
      mate: true,
      moves: ["B*3c", "1a1b", "G*2b", "1b1c", "G*2d"],
    });
  });

  it("手数の上限より長い詰みと、詰まない局面は詰みなし", () => {
    expect(solveMate(SFEN_MATE_5, 3)).toEqual({ mate: false, aborted: false });
    expect(solveMate(SFEN_NO_MATE)).toEqual({ mate: false, aborted: false });
  });

  it("ノード数の上限で打ち切る", () => {
    expect(solveMate(SFEN_MATE_5, 7, { nodes: 10 })).toEqual({ mate: false, aborted: true });
  });

  it("逃げる側から読むと最も長く逃げる手から始まる", () => {
    const after = playMove(SFEN_MATE_5, "B*3c")!;
    expect(solveEscape(after, 4)).toEqual({
      mate: true,
      moves: ["1a1b", "G*2b", "1b1c", "G*2d"],
    });
    // 詰んだ局面は空の手順
    expect(solveEscape(playMove(SFEN_MATE_1, "G*5b")!)).toEqual({ mate: true, moves: [] });
  });
});

describe("judgeTsumero", () => {
  it("詰めろになる手とならない手を区別する", () => {
    expect(judgeTsumero(SFEN_TSUMERO, "2d2c")).toEqual({ tsumero: true, mate: ["G*2b"] });
    expect(judgeTsumero(SFEN_TSUMERO, "9i9h")).toEqual({ tsumero: false, reason: "none" });
    // 王手は詰めろとしない
    expect(judgeTsumero(SFEN_TSUMERO, "G*2b")).toEqual({ tsumero: false, reason: "check" });
    expect(judgeTsumero(SFEN_TSUMERO, "2d2a")).toEqual({ tsumero: false, reason: "illegal" });
  });

  it("passSfen は手番だけ入れ替える", () => {
    expect(passSfen("8k/9/9/9/9/9/9/9/K8 b G 3")).toBe("8k/9/9/9/9/9/9/9/K8 w G 3");
  });
});

describe("nonDefendingReply", () => {
  it("実戦の手が詰みを防がなければそれを選ぶ", () => {
    const after = playMove(SFEN_TSUMERO, "2d2c")!;
    expect(nonDefendingReply(after, "1b1c")).toEqual({ reply: "1b1c", mate: ["G*2b"] });
  });

  it("実戦の手が無ければ、詰みを防がない合法手を選ぶ", () => {
    const after = playMove(SFEN_TSUMERO, "2d2c")!;
    const r = nonDefendingReply(after, undefined)!;
    const next = playMove(after, r.reply)!;
    expect(solveMate(next).mate).toBe(true);
  });
});

describe("attackStep", () => {
  it("詰み・詰みが続く・詰まなくなるを判定する", () => {
    expect(attackStep(SFEN_MATE_1, "G*5b", 1)).toEqual({ status: "mated" });
    expect(attackStep(SFEN_MATE_5, "B*3c", 5)).toEqual({
      status: "continue",
      reply: "1a1b",
      mate: ["G*2b", "1b1c", "G*2d"],
    });
    // 王手でない手
    expect(attackStep(SFEN_MATE_5, "9i9h", 5)).toEqual({ status: "failed", reason: "not-check" });
    // 王手だが逃げられる
    expect(attackStep(SFEN_MATE_5, "G*2b", 5)).toEqual({ status: "failed", reason: "escape" });
    // 残りの手数では詰まない
    expect(attackStep(SFEN_MATE_5, "B*3c", 3)).toEqual({ status: "failed", reason: "escape" });
  });
});
