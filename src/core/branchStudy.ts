import { Position } from "tsshogi";
import type { AnalysisRecord, Judgement, MoveReview } from "./analysis";
import {
  SEVERITY,
  createReviewLookup,
  formatPositionMove,
  formatUsiMove,
  usiMoves,
} from "./branches";
import { COMMON_POSITION_PLIES, playerSide, type CommonPosition, type Side } from "./stats";
import type { GameRecord } from "./types";

/**
 * 分岐点を学ぶための手順の木。開始局面から分岐点までの共通手順 (幹) と、分岐点で指された候補手、
 * 候補手ごとにその手を指した対局の続き、の 3 段でできている。読み出し時に計算し、GameRecord には何も足さない。
 */

/** 候補手の先に続ける手数 (候補手を含まない) */
export const STUDY_CONTINUATION_PLIES = 12;

export interface StudyStep {
  /** この手を指した後の手数 (対局の手数) */
  ply: number;
  usi: string;
  /** 表示用 (例: ▲7六歩) */
  label: string;
  /** この手を指した後の局面 (手数つきの SFEN) */
  sfen: string;
}

export interface BranchCandidate {
  usi: string;
  /** 表示用 (例: ▲6五歩) */
  label: string;
  count: number;
  gameIds: string[];
  /** 解析済みの対局での判定。対局ごとに違えば悪い方。解析が無ければ null */
  judgement: Judgement | null;
  /** 解析済みの対局での損失 (cp)。対局ごとに違えば大きい方。解析が無ければ null */
  loss: number | null;
  /** 最善手 (USI)。指した手が最善なら省略 */
  best?: string;
  bestLabel?: string;
}

export interface BranchCandidates {
  /** 分岐点の局面での手番 */
  turn: Side;
  /** 本人の側 (通った対局の先頭の対局で決める) */
  side: Side;
  /** 分岐点で指すのが本人か相手か */
  mover: "self" | "opponent";
  /** 指した手 (回数の多い順、同数なら USI 順) */
  candidates: BranchCandidate[];
}

export interface StudyLine {
  gameId: string;
  /** 候補手とその先 (その対局の手順) */
  steps: StudyStep[];
}

export interface StudyCandidate extends BranchCandidate {
  /** この手を指した対局ごとの続き。順序は gameIds と同じ */
  lines: StudyLine[];
}

export interface BranchStudy extends BranchCandidates {
  key: string;
  /** 開始局面 (手数つきの SFEN) */
  start: string;
  /** 開始局面から分岐点までの共通手順。最後の手の局面が分岐点 */
  path: StudyStep[];
  /** 共通手順をとった対局 */
  pathGameId: string;
  candidates: StudyCandidate[];
}

/** その対局で分岐点の局面になった手数。見つからなければ -1 */
export function plyOf(g: GameRecord, key: string): number {
  return g.positions.slice(0, COMMON_POSITION_PLIES + 1).indexOf(key);
}

/** 局面 `sfen` から `moves` を順に指した手順。指せない手があればそこで止める */
function walk(sfen: string, moves: string[], firstPly: number): StudyStep[] {
  const pos = Position.newBySFEN(sfen);
  if (!pos) return [];
  const out: StudyStep[] = [];
  for (const [i, usi] of moves.entries()) {
    const move = pos.createMoveByUSI(usi);
    if (!move || !pos.isValidMove(move)) break;
    const label = formatPositionMove(pos, move);
    pos.doMove(move);
    const ply = firstPly + i;
    out.push({ ply, usi, label, sfen: pos.getSFEN(ply + 1) });
  }
  return out;
}

export type ReviewOf = (g: GameRecord) => Map<number, MoveReview> | null;

/** 分岐点を通った対局のうち、本人の側が先頭の対局と同じもの (候補手を混ぜないため) */
function sameSideGames(p: CommonPosition, games: GameRecord[], name: string) {
  const byId = new Map(games.map((g) => [g.id, g] as const));
  const list = p.gameIds.map((id) => byId.get(id)).filter((g) => g !== undefined);
  const side = list[0] ? playerSide(list[0], name) : null;
  return { side, list: list.filter((g) => playerSide(g, name) === side) };
}

/**
 * 局面 `key` で `list` の対局が指した手を数え、解析があれば判定と最善手を付ける。
 * 手数は各対局でその局面になった手数 (対局ごとに違ってもよい)。
 */
export function collectCandidates(
  key: string,
  list: GameRecord[],
  reviewOf: ReviewOf,
): BranchCandidate[] {
  const moves = new Map<string, BranchCandidate>();
  for (const g of list) {
    const ply = plyOf(g, key);
    const usi = ply < 0 ? undefined : usiMoves(g.usi)[ply];
    if (!usi) continue;
    const c = moves.get(usi) ?? {
      usi,
      label: formatUsiMove(key, usi),
      count: 0,
      gameIds: [],
      judgement: null,
      loss: null,
    };
    c.count++;
    c.gameIds.push(g.id);
    const r = reviewOf(g)?.get(ply + 1);
    if (r && r.played === usi) {
      if (c.judgement === null || SEVERITY[r.judgement] > SEVERITY[c.judgement]) {
        c.judgement = r.judgement;
      }
      c.loss = Math.max(c.loss ?? 0, r.loss);
      if (r.best && !c.best) {
        c.best = r.best;
        c.bestLabel = formatUsiMove(key, r.best);
      }
    }
    moves.set(usi, c);
  }
  return Array.from(moves.values()).sort((a, b) => b.count - a.count || a.usi.localeCompare(b.usi));
}

function candidatesWith(
  p: CommonPosition,
  games: GameRecord[],
  name: string,
  reviewOf: ReviewOf,
): (BranchCandidates & { list: GameRecord[] }) | null {
  const { side, list } = sameSideGames(p, games, name);
  if (!side) return null;
  const turn: Side = p.key.split(/\s+/)[1] === "w" ? "white" : "black";
  return {
    turn,
    side,
    mover: turn === side ? "self" : "opponent",
    candidates: collectCandidates(p.key, list, reviewOf),
    list,
  };
}

/**
 * 分岐点ごとの候補手 (本人の手番なら本人の手、相手の手番なら相手の手) と判定。一覧の 1 行に出す用。
 * 解析の引き直しを避けるため、まとめて計算する。
 */
export function branchCandidates(
  positions: CommonPosition[],
  games: GameRecord[],
  analyses: Map<string, AnalysisRecord>,
  name: string,
): Map<string, BranchCandidates> {
  const reviewOf = createReviewLookup(analyses);
  const out = new Map<string, BranchCandidates>();
  for (const p of positions) {
    const c = candidatesWith(p, games, name, reviewOf);
    if (c) out.set(p.key, { turn: c.turn, side: c.side, mover: c.mover, candidates: c.candidates });
  }
  return out;
}

/**
 * 分岐点 1 件の学習用の手順の木を作る。共通手順は通った対局の先頭の対局の手順をとる
 * (手順前後で同じ局面に来た対局があっても、幹は 1 本)。候補手の先は `continuation` 手まで。
 */
export function buildBranchStudy(
  p: CommonPosition,
  games: GameRecord[],
  analyses: Map<string, AnalysisRecord>,
  name: string,
  continuation = STUDY_CONTINUATION_PLIES,
): BranchStudy | null {
  const c = candidatesWith(p, games, name, createReviewLookup(analyses));
  const first = c?.list[0];
  if (!c || !first) return null;
  const firstPly = plyOf(first, p.key);
  const startKey = first.positions[0];
  if (firstPly < 0 || !startKey) return null;
  const start = `${startKey} 1`;
  const path = walk(start, usiMoves(first.usi).slice(0, firstPly), 1);
  if (path.length !== firstPly) return null;
  const byId = new Map(c.list.map((g) => [g.id, g] as const));
  const candidates = c.candidates.map((cand) => ({
    ...cand,
    lines: cand.gameIds.flatMap((id) => {
      const g = byId.get(id);
      const ply = g ? plyOf(g, p.key) : -1;
      if (!g || ply < 0) return [];
      const moves = usiMoves(g.usi).slice(ply, ply + 1 + continuation);
      return [{ gameId: id, steps: walk(`${p.key} ${ply + 1}`, moves, ply + 1) }];
    }),
  }));
  return {
    key: p.key,
    turn: c.turn,
    side: c.side,
    mover: c.mover,
    start,
    path,
    pathGameId: first.id,
    candidates,
  };
}
