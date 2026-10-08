import { Position, Square, handPieceTypes, type Move } from "tsshogi";

/**
 * 短手数の詰み探索と詰めろの判定。tsshogi には合法手の列挙が無いので、
 * 駒が届きうるマス (同じ筋・段・斜め、または 2 マス以内) を候補にして isValidMove で確かめる。
 * 詰ます側は王手だけ、逃げる側は全ての合法手を読む。最短の詰みを探し、逃げる側は最も長く逃げる手を選ぶ。
 * 深さ (手数) とノード数・時間の上限を持ち、上限に当たったら打ち切る (aborted)。
 */

/** 探索する詰みの最大手数。これより長い詰みは扱わない */
export const MAX_MATE_PLY = 7;

export interface SearchLimits {
  /** 読む局面の上限 */
  nodes?: number;
  /** 時間の上限 (ms) */
  ms?: number;
}

const DEFAULT_LIMITS: Required<SearchLimits> = { nodes: 300_000, ms: 3000 };

export type MateResult =
  /** 詰む。moves は詰ます側の手から始まる手順 (USI) */
  | { mate: true; moves: string[] }
  /** 上限の手数では詰まない。aborted なら上限で打ち切ったので分からない */
  | { mate: false; aborted: boolean };

class Aborted extends Error {}

/** from から to へ駒が届きうるか (駒の種類を問わない粗い絞り込み) */
function reachable(from: Square, to: Square): boolean {
  const df = Math.abs(from.file - to.file);
  const dr = Math.abs(from.rank - to.rank);
  return (df <= 1 && dr <= 2) || df === 0 || dr === 0 || df === dr;
}

/** 手番側の合法手を全て列挙する (成り・不成の両方、打ち) */
export function legalMoves(pos: Position): Move[] {
  const out: Move[] = [];
  const color = pos.color;
  for (const from of Square.all) {
    const piece = pos.board.at(from);
    if (!piece || piece.color !== color) continue;
    for (const to of Square.all) {
      if (to.index === from.index || !reachable(from, to)) continue;
      const target = pos.board.at(to);
      if (target && target.color === color) continue;
      const move = pos.createMove(from, to);
      if (!move) continue;
      const promoted = move.withPromote();
      if (pos.isValidMove(promoted)) out.push(promoted);
      if (pos.isValidMove(move)) out.push(move);
    }
  }
  const hand = pos.hand(color);
  for (const type of handPieceTypes) {
    if (hand.count(type) === 0) continue;
    for (const to of Square.all) {
      if (pos.board.at(to)) continue;
      const move = pos.createMove(type, to);
      if (move && pos.isValidMove(move)) out.push(move);
    }
  }
  return out;
}

/** 手番側の王手になる合法手 */
export function checkMoves(pos: Position): Move[] {
  return legalMoves(pos).filter((m) => {
    pos.doMove(m, { ignoreValidation: true });
    const check = pos.checked;
    pos.undoMove(m);
    return check;
  });
}

class Search {
  private nodes = 0;
  private readonly deadline: number;
  private readonly maxNodes: number;
  /** 詰まないと分かった (局面, 残り手数) */
  private readonly noMate = new Set<string>();

  constructor(limits: SearchLimits) {
    const l = { ...DEFAULT_LIMITS, ...limits };
    this.maxNodes = l.nodes;
    this.deadline = Date.now() + l.ms;
  }

  private tick() {
    this.nodes++;
    if (this.nodes > this.maxNodes || (this.nodes % 256 === 0 && Date.now() > this.deadline))
      throw new Aborted();
  }

  /** 手番側 (詰ます側) が depth 手以内に詰ませる手順。無ければ null */
  attack(pos: Position, depth: number): string[] | null {
    if (depth < 1) return null;
    this.tick();
    const key = `${pos.sfen}|${depth}`;
    if (this.noMate.has(key)) return null;
    for (const move of checkMoves(pos)) {
      pos.doMove(move, { ignoreValidation: true });
      const line = this.defend(pos, depth - 1);
      pos.undoMove(move);
      if (line) return [move.usi, ...line];
    }
    this.noMate.add(key);
    return null;
  }

  /** 手番側 (逃げる側、王手をかけられている) が depth 手以内に詰まされるなら、最も長く逃げる手順 */
  defend(pos: Position, depth: number): string[] | null {
    this.tick();
    const moves = legalMoves(pos);
    if (moves.length === 0) return pos.checked ? [] : null;
    if (depth < 2) return null;
    let best: string[] | null = null;
    for (const move of moves) {
      pos.doMove(move, { ignoreValidation: true });
      const line = this.attack(pos, depth - 1);
      pos.undoMove(move);
      if (!line) return null;
      if (!best || line.length + 1 > best.length) best = [move.usi, ...line];
    }
    return best;
  }
}

function positionOf(sfen: string): Position | null {
  return Position.newBySFEN(sfen.trim().split(/\s+/).length === 3 ? `${sfen} 1` : sfen);
}

function run(fn: (s: Search) => string[] | null, limits: SearchLimits): MateResult {
  try {
    const line = fn(new Search(limits));
    return line ? { mate: true, moves: line } : { mate: false, aborted: false };
  } catch (e) {
    if (e instanceof Aborted) return { mate: false, aborted: true };
    throw e;
  }
}

/**
 * 手番側が maxPly 手以内に詰ませられるか。短い手数から順に読み、最短の詰みを返す。
 * 逃げる側は最も長く逃げる手を選ぶ。
 */
export function solveMate(
  sfen: string,
  maxPly = MAX_MATE_PLY,
  limits: SearchLimits = {},
): MateResult {
  const pos = positionOf(sfen);
  if (!pos) return { mate: false, aborted: false };
  return run((s) => {
    for (let d = 1; d <= maxPly; d += 2) {
      const line = s.attack(pos, d);
      if (line) return line;
    }
    return null;
  }, limits);
}

/**
 * 手番側 (王手をかけられた側) が maxPly 手以内に必ず詰まされるか。
 * 詰まされるなら、最も長く逃げる手から始まる手順を返す (詰んでいれば空の手順)。
 */
export function solveEscape(
  sfen: string,
  maxPly = MAX_MATE_PLY,
  limits: SearchLimits = {},
): MateResult {
  const pos = positionOf(sfen);
  if (!pos) return { mate: false, aborted: false };
  return run((s) => {
    for (let d = 0; d <= maxPly; d += 2) {
      const line = s.defend(pos, d);
      if (line) return line;
    }
    return null;
  }, limits);
}

/** 手番を入れ替えた SFEN (パスした局面)。手数は変えない */
export function passSfen(sfen: string): string {
  const parts = sfen.trim().split(/\s+/);
  parts[1] = parts[1] === "b" ? "w" : "b";
  return parts.join(" ");
}

/** 局面 (SFEN) で手 (USI) を指した後の SFEN。指せなければ null */
export function playMove(sfen: string, usi: string): string | null {
  const pos = positionOf(sfen);
  if (!pos) return null;
  const move = pos.createMoveByUSI(usi);
  if (!move || !pos.isValidMove(move)) return null;
  const ply = Number(sfen.trim().split(/\s+/)[3] ?? 1);
  pos.doMove(move);
  return pos.getSFEN(ply + 1);
}

/** 手 (USI) が王手か */
export function isCheckMove(sfen: string, usi: string): boolean {
  const after = playMove(sfen, usi);
  return !!after && !!positionOf(after)?.checked;
}

export type TsumeroResult =
  /** 詰めろ。mate は相手がパスしたときの詰み手順 */
  | { tsumero: true; mate: string[] }
  /** 詰めろではない。reason: illegal = 指せない手、check = 王手 (詰めろでなく王手)、none = 詰まない、aborted = 打ち切り */
  | { tsumero: false; reason: "illegal" | "check" | "none" | "aborted" };

/**
 * 手 (USI) が詰めろか。指した後に相手がパスすれば (手番を入れ替えると) maxPly 手以内に詰む手を詰めろとする。
 * 王手は詰めろに含めない (相手はパスできないので、詰むなら詰将棋として扱う)。
 */
export function judgeTsumero(
  sfen: string,
  usi: string,
  maxPly = MAX_MATE_PLY,
  limits: SearchLimits = {},
): TsumeroResult {
  const after = playMove(sfen, usi);
  if (!after) return { tsumero: false, reason: "illegal" };
  if (positionOf(after)?.checked) return { tsumero: false, reason: "check" };
  const r = solveMate(passSfen(after), maxPly, limits);
  if (r.mate) return { tsumero: true, mate: r.moves };
  return { tsumero: false, reason: r.aborted ? "aborted" : "none" };
}

/**
 * 詰めろをかけられた側の応手のうち、詰みを防がない手 (指した後に maxPly 手以内に詰む手) を 1 つ選ぶ。
 * preferred (実戦の手) が詰みを防がなければそれ、無ければ合法手を順に試す。
 * 返すのは応手と、その後の詰み手順。全ての応手が詰みを防ぐ (または読み切れない) なら null。
 */
export function nonDefendingReply(
  sfen: string,
  preferred: string | undefined,
  maxPly = MAX_MATE_PLY,
  limits: SearchLimits = {},
): { reply: string; mate: string[] } | null {
  const pos = positionOf(sfen);
  if (!pos) return null;
  const candidates = legalMoves(pos).map((m) => m.usi);
  const order =
    preferred && candidates.includes(preferred) ? [preferred, ...candidates] : candidates;
  const deadline = Date.now() + (limits.ms ?? DEFAULT_LIMITS.ms) * 3;
  for (const usi of new Set(order)) {
    if (Date.now() > deadline) break;
    const after = playMove(sfen, usi);
    if (!after) continue;
    const r = solveMate(after, maxPly, limits);
    if (r.mate) return { reply: usi, mate: r.moves };
  }
  return null;
}

export type AttackStep =
  /** 詰んだ */
  | { status: "mated" }
  /** 詰みが続く。reply は相手が最も長く逃げる手、mate はその後の詰み手順 */
  | { status: "continue"; reply: string; mate: string[] }
  /** 詰まなくなった (王手でない、逃げられる、指せない手) */
  | { status: "failed"; reason: "illegal" | "not-check" | "escape" | "aborted" };

/**
 * 詰将棋の 1 手を判定する。詰ます側が usi を指した後、詰んでいれば mated、
 * 逃げる側が最も長く逃げても残り remaining 手以内に詰むなら continue、それ以外は failed。
 */
export function attackStep(
  sfen: string,
  usi: string,
  remaining: number,
  limits: SearchLimits = {},
): AttackStep {
  const after = playMove(sfen, usi);
  if (!after) return { status: "failed", reason: "illegal" };
  const pos = positionOf(after);
  if (!pos?.checked) return { status: "failed", reason: "not-check" };
  const r = solveEscape(after, Math.max(0, remaining - 1), limits);
  if (!r.mate) return { status: "failed", reason: r.aborted ? "aborted" : "escape" };
  const [reply, ...mate] = r.moves;
  if (!reply) return { status: "mated" };
  return { status: "continue", reply, mate };
}
