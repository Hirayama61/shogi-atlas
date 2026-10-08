import { Position, type Move } from "tsshogi";
import { isAnalysisStale, reviewMoves, type AnalysisRecord, type Judgement } from "./analysis";
import { mirror, piecesOnBoard, toBoardView, type BoardView } from "./board";
import { formatPositionMove, usiMoves } from "./branches";
import { SELF_NAME } from "./self";
import type { Side } from "./stats";
import type { GameRecord } from "./types";

/**
 * 終盤力強化 (囲い崩しの問題集)。全棋譜の解析済み局面から、囲いを崩す手 (崩し方) と
 * 崩されかけた囲いを受ける手 (崩され方) の問題を作り、囲いと玉周りの形で問題群にまとめる。
 * 問題は読み出し時に計算し、GameRecord には何も足さない。
 */

/** attack = 崩し方 (相手の囲いを崩す手番)、defense = 崩され方 (自分の囲いを受ける手番) */
export type ProblemKind = "attack" | "defense";

export const PROBLEM_KIND_LABEL: Record<ProblemKind, string> = {
  attack: "崩し方",
  defense: "崩され方",
};

/** 序盤 (phaseOf の opening と同じ 30 手まで) は囲いを崩す局面ではないので問題にしない */
export const ENDGAME_MIN_PLY = 31;

/** 開始局面の盤上の駒がこれより少なければ途中局面 (十枚落ちの初形でも 30 枚) */
const MIDGAME_START_PIECES = 30;

/** 手番側から見てこれより悪い局面は、最善手でも挽回できないので問題にしない (cp) */
export const HOPELESS_CP = 1500;

const MISSED: ReadonlySet<Judgement> = new Set(["mistake", "blunder"]);

export interface EndgameProblem {
  /** `<対局 ID>:<手数>` */
  id: string;
  kind: ProblemKind;
  /** 崩す (崩される) 側の囲い */
  castle: string;
  /** 守る側の玉周りの形 (kingShapeKey) */
  shape: string;
  gameId: string;
  /** 答える手の手数。問題の局面はその 1 手前 */
  ply: number;
  /** 問題の局面 (手数つき SFEN) */
  sfen: string;
  /** 手番 (答える側) */
  side: Side;
  /** 答える側の対局者名 */
  mover: string;
  /** 相手の対局者名 */
  opponent: string;
  /** エンジンの最善手 (USI) と読み筋 */
  best: string;
  pv: string[];
  /** 実戦の手 (USI) と、その手の手番側から見た損失 (cp) */
  played: string;
  loss: number;
  judgement: Judgement;
  /** 実戦で最善手を逃した (悪手以上) */
  missed: boolean;
  startedAt?: string;
}

export interface ProblemGroup {
  /** `<kind>|<castle>|<shape>` */
  key: string;
  kind: ProblemKind;
  castle: string;
  shape: string;
  problems: EndgameProblem[];
  /** 出典の対局数 */
  games: number;
  /** 出典の対局者 (答える側)。問題数の多い順 */
  movers: string[];
  /** 自分が答える側の問題数と、そのうち実戦で逃した数 */
  self: number;
  selfMissed: number;
}

/** 盤のマス (筋, 段) */
type Square = [number, number];

function kingSquare(view: BoardView): Square | null {
  for (const [key, p] of view.pieces) if (p === "K") return [Number(key[0]), Number(key[1])];
  return null;
}

/** 守る側を先手 (下側) に揃えた盤 */
function defenderView(positionKey: string, defender: Side): BoardView {
  const view = toBoardView(positionKey);
  return defender === "black" ? view : mirror(view);
}

/**
 * 守る側の玉周りの形のキー。守る側を先手に揃え (後手なら盤を回す)、玉のマスと
 * 玉を囲む 3 × 3 の駒配置 (守る側は大文字、攻める側は小文字、空きは "."、盤の外は "#") を並べる。
 * 局面全体ではなく局所の形なので、別の対局・別の対局者でも同じ形なら同じキーになる。玉が無ければ null。
 */
export function kingShapeKey(positionKey: string, defender: Side): string | null {
  const view = defenderView(positionKey, defender);
  const king = kingSquare(view);
  if (!king) return null;
  const [kf, kr] = king;
  const cells: string[] = [];
  for (let r = kr - 1; r <= kr + 1; r++) {
    // 9 筋 (左) から 1 筋 (右) の順
    for (let f = kf + 1; f >= kf - 1; f--) {
      if (f < 1 || f > 9 || r < 1 || r > 9) cells.push("#");
      else cells.push(view.pieces.get(`${f}${r}`) ?? ".");
    }
  }
  return `${kf}${kr}:${cells.join(",")}`;
}

/** USI のマス ("7g") を [筋, 段] に */
function usiSquare(s: string): Square {
  return [Number(s[0]), s.charCodeAt(1) - 96];
}

/** 手の移動先 */
function destination(usi: string): Square {
  return usiSquare(usi.slice(2, 4));
}

/** その側の玉から 2 マス以内 (5 × 5) か。玉が無ければ false */
function inKingZone(positionKey: string, side: Side, sq: Square): boolean {
  const view = toBoardView(positionKey);
  for (const [key, p] of view.pieces) {
    if (p !== (side === "black" ? "K" : "k")) continue;
    const f = Number(key[0]);
    const r = Number(key[1]);
    return Math.abs(f - sq[0]) <= 2 && Math.abs(r - sq[1]) <= 2;
  }
  return false;
}

/** 駒を取るか打つ手 (囲いに直接手を付ける手) */
function isContact(before: string, after: string | undefined, usi: string): boolean {
  if (usi.includes("*")) return true;
  return after !== undefined && piecesOnBoard(after) < piecesOnBoard(before);
}

const other = (s: Side): Side => (s === "black" ? "white" : "black");

/**
 * 1 局から問題を抜き出す。解析が無いか古ければ空。
 * - 崩し方: 最善手が相手玉の 5 × 5 に入る局面で、実戦で逃した (悪手以上) か、最善手を指してそれが駒を取るか打つ手だった。
 * - 崩され方: 直前に相手の手が自玉の 5 × 5 に入った局面で、実戦で受けの最善手を逃したか、
 *   直前の相手の手が駒を取るか打つ手で最善手で受けた。
 * 囲いが「不明」の側、手番側から見て大差で負けの局面 (HOPELESS_CP)、序盤 (minPly より前) は除く。
 */
export function extractProblems(
  game: GameRecord,
  analysis: AnalysisRecord | undefined,
  minPly = ENDGAME_MIN_PLY,
): EndgameProblem[] {
  if (!analysis || isAnalysisStale(game, analysis)) return [];
  const pvOf = new Map(analysis.plies.map((p) => [p.ply, p.pv] as const));
  const moves = usiMoves(game.usi);
  // 途中局面から始まる対局 (盤上の駒が駒落ちの初形より少ない) には序盤が無い
  const midgameStart = piecesOnBoard(game.positions[0] ?? "") < MIDGAME_START_PIECES;
  const out: EndgameProblem[] = [];
  for (const m of reviewMoves(game, analysis)) {
    if (m.ply < minPly && !midgameStart) continue;
    const best = m.best ?? (m.playedBest ? m.played : undefined);
    if (!best) continue;
    const before = game.positions[m.ply - 1];
    if (before === undefined) continue;
    const after = game.positions[m.ply];
    const sign = m.side === "black" ? 1 : -1;
    if (sign * m.cpBefore < -HOPELESS_CP) continue;
    const missed = MISSED.has(m.judgement) && !m.playedBest;
    const playedBest = m.playedBest === true;

    let kind: ProblemKind | null = null;
    let defender: Side = other(m.side);
    if (inKingZone(before, defender, destination(best))) {
      if (missed || (playedBest && isContact(before, after, m.played))) kind = "attack";
    }
    if (!kind && m.ply >= 2) {
      const prev = moves[m.ply - 2];
      const prevBefore = game.positions[m.ply - 2];
      if (prev && prevBefore !== undefined && inKingZone(before, m.side, destination(prev))) {
        if (missed || (playedBest && isContact(prevBefore, before, prev))) {
          kind = "defense";
          defender = m.side;
        }
      }
    }
    if (!kind) continue;
    const castle = defender === "black" ? game.opening.blackCastle : game.opening.whiteCastle;
    if (!castle || castle === "不明") continue;
    const shape = kingShapeKey(before, defender);
    if (!shape) continue;
    const pv = pvOf.get(m.ply - 1);
    const problem: EndgameProblem = {
      id: `${game.id}:${m.ply}`,
      kind,
      castle,
      shape,
      gameId: game.id,
      ply: m.ply,
      sfen: `${before} ${m.ply}`,
      side: m.side,
      mover: m.side === "black" ? game.black : game.white,
      opponent: m.side === "black" ? game.white : game.black,
      best,
      pv: pv && pv[0] === best ? pv : [best],
      played: m.played,
      loss: m.loss,
      judgement: m.judgement,
      missed,
    };
    if (game.startedAt) problem.startedAt = game.startedAt;
    out.push(problem);
  }
  return out;
}

/**
 * 全棋譜の問題を囲いと玉周りの形で問題群にまとめる。
 * 並びは、自分が実戦で逃した問題の多い群 → 自分が答える側の問題の多い群 → 問題の多い群。
 */
export function buildProblemGroups(
  games: GameRecord[],
  analyses: Map<string, AnalysisRecord>,
  minPly = ENDGAME_MIN_PLY,
): ProblemGroup[] {
  const groups = new Map<string, ProblemGroup>();
  for (const g of games) {
    for (const p of extractProblems(g, analyses.get(g.id), minPly)) {
      const key = `${p.kind}|${p.castle}|${p.shape}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          kind: p.kind,
          castle: p.castle,
          shape: p.shape,
          problems: [],
          games: 0,
          movers: [],
          self: 0,
          selfMissed: 0,
        };
        groups.set(key, group);
      }
      group.problems.push(p);
    }
  }
  for (const group of groups.values()) {
    group.games = new Set(group.problems.map((p) => p.gameId)).size;
    const counts = new Map<string, number>();
    for (const p of group.problems) counts.set(p.mover, (counts.get(p.mover) ?? 0) + 1);
    group.movers = [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => name);
    const own = group.problems.filter((p) => p.mover === SELF_NAME);
    group.self = own.length;
    group.selfMissed = own.filter((p) => p.missed).length;
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.selfMissed - a.selfMissed ||
      b.self - a.self ||
      b.problems.length - a.problems.length ||
      a.key.localeCompare(b.key),
  );
}

/** 囲いごとの問題数 (多い順) */
export function castleCounts(groups: ProblemGroup[]): Array<{ castle: string; problems: number }> {
  const counts = new Map<string, number>();
  for (const g of groups) counts.set(g.castle, (counts.get(g.castle) ?? 0) + g.problems.length);
  return [...counts]
    .map(([castle, problems]) => ({ castle, problems }))
    .sort((a, b) => b.problems - a.problems || a.castle.localeCompare(b.castle));
}

/** 1 問の記録。correct は最後に答えたときの正誤 */
export interface ProblemRecord {
  attempts: number;
  correct: boolean;
}

/** 0 = 未出題、1 = 最後に不正解、2 = 最後に正解 */
function rank(record: ProblemRecord | undefined): number {
  if (!record) return 0;
  return record.correct ? 2 : 1;
}

/** 出題順。未出題 → 最後に不正解 → 正解の順、同じなら自分が逃した問題 → 手数の順 */
export function orderProblems(
  problems: EndgameProblem[],
  records: Record<string, ProblemRecord>,
): EndgameProblem[] {
  const selfFirst = (p: EndgameProblem) => (p.mover === SELF_NAME && p.missed ? 0 : 1);
  return [...problems].sort(
    (a, b) =>
      rank(records[a.id]) - rank(records[b.id]) ||
      selfFirst(a) - selfFirst(b) ||
      a.id.localeCompare(b.id),
  );
}

/** 次に出す問題。今の問題 (current) は、ほかに問題があれば後回しにする */
export function nextProblem(
  problems: EndgameProblem[],
  records: Record<string, ProblemRecord>,
  current?: string,
): EndgameProblem | undefined {
  const ordered = orderProblems(problems, records);
  return ordered.find((p) => p.id !== current) ?? ordered[0];
}

export interface ProblemChoice {
  usi: string;
  label: string;
}

/** 局面 (手数つき SFEN) で指せる手か。指せれば表記を返す */
function labelIfValid(pos: Position, usi: string): string | null {
  const move = pos.createMoveByUSI(usi);
  if (!move || !pos.isValidMove(move)) return null;
  return formatPositionMove(pos, move);
}

const FILES = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const HAND_LETTER: Partial<Record<string, string>> = {
  pawn: "P",
  lance: "L",
  knight: "N",
  silver: "S",
  gold: "G",
  bishop: "B",
  rook: "R",
};
const RANKS = "abcdefghi";

/** 小さな文字列ハッシュ (選択肢の並びを問題ごとに固定するため) */
function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * 答えの選択肢。最善手・実戦の手に、囲いの 5 × 5 に入る合法手を足して count 個にする。
 * 足す手と並びは問題 ID から決まる (開き直しても同じ)。
 */
export function problemChoices(problem: EndgameProblem, count = 4): ProblemChoice[] {
  const pos = Position.newBySFEN(problem.sfen);
  if (!pos) return [{ usi: problem.best, label: problem.best }];
  const key = problem.sfen.split(" ").slice(0, 3).join(" ");
  const defender = problem.kind === "attack" ? other(problem.side) : problem.side;
  const chosen = new Map<string, string>();
  for (const usi of [problem.best, problem.played]) {
    const label = labelIfValid(pos, usi);
    if (label) chosen.set(usi, label);
  }
  // 囲いの 5 × 5 に入る合法手 (盤上の駒の移動と持ち駒を打つ手)
  const view = toBoardView(key);
  const mine = (p: string) =>
    problem.side === "black" ? p === p.toUpperCase() : p === p.toLowerCase();
  const targets: string[] = [];
  for (const f of FILES)
    for (const [i, r] of [...RANKS].entries())
      if (inKingZone(key, defender, [f, i + 1])) targets.push(`${f}${r}`);
  const extra: string[] = [];
  for (const [sq, piece] of view.pieces) {
    if (!mine(piece)) continue;
    const from = `${sq[0]}${RANKS[Number(sq[1]) - 1]}`;
    for (const to of targets) for (const promote of ["", "+"]) extra.push(`${from}${to}${promote}`);
  }
  const hand = problem.side === "black" ? pos.blackHand : pos.whiteHand;
  hand.forEach((type, n) => {
    const letter = HAND_LETTER[type];
    if (n > 0 && letter) for (const to of targets) extra.push(`${letter}*${to}`);
  });
  const seed = problem.id;
  const shuffled = extra
    .filter((u) => !chosen.has(u))
    .sort((a, b) => hashOf(seed + a) - hashOf(seed + b));
  for (const usi of shuffled) {
    if (chosen.size >= count) break;
    // 成れない手に "+" を付けたものなどは弾かれる
    const label = labelIfValid(pos, usi);
    if (label && ![...chosen.values()].includes(label)) chosen.set(usi, label);
  }
  return [...chosen]
    .map(([usi, label]) => ({ usi, label }))
    .sort((a, b) => hashOf(seed + a.usi) - hashOf(seed + b.usi));
}

/** 局面 (手数つき SFEN) から手順を表記にする (例: ["▲2一飛", "△同銀"])。指せない手で止める */
export function formatLine(sfen: string, usis: string[]): string[] {
  const pos = Position.newBySFEN(sfen);
  if (!pos) return [];
  const out: string[] = [];
  let lastMove: Move | undefined;
  for (const usi of usis) {
    const move = pos.createMoveByUSI(usi);
    if (!move || !pos.isValidMove(move)) break;
    out.push(formatPositionMove(pos, move, lastMove));
    pos.doMove(move);
    lastMove = move;
  }
  return out;
}
