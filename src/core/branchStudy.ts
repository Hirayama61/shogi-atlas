import { Position } from "tsshogi";
import type { AnalysisRecord, Judgement, MoveReview } from "./analysis";
import {
  BRANCH_KINDS,
  SEVERITY,
  createReviewLookup,
  formatPositionMove,
  formatUsiMove,
  reviewBranches,
  usiMoves,
  type BranchKind,
} from "./branches";
import {
  COMMON_POSITION_PLIES,
  findCommonPositions,
  playerSide,
  type CommonPosition,
  type Side,
} from "./stats";
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

/** 分岐点の木の節。節どうしは「親の分岐点で指した手の先にある分岐点」でつながる */
export interface BranchNode extends CommonPosition, BranchCandidates {
  kind: BranchKind;
  /** 本人の戦法 (通った対局で多いもの) */
  opening: string;
  /** 親の分岐点でこの節へ進んだ手 (親の候補手)。根なら省略 */
  via?: { usi: string; label: string };
  /** 下流の分岐点。悪手を含む枝 → 局数の多い順 */
  children: BranchNode[];
}

export interface BranchTree {
  /** 本人の側 */
  side: Side;
  roots: BranchNode[];
  /** 節の数 */
  size: number;
}

function hasMistake(n: BranchNode): boolean {
  return n.kind === "mistake" || n.children.some(hasMistake);
}

function sortNodes(nodes: BranchNode[]): BranchNode[] {
  for (const n of nodes) sortNodes(n.children);
  const rank = new Map(nodes.map((n) => [n, hasMistake(n) ? 0 : 1] as const));
  return nodes.sort(
    (a, b) =>
      rank.get(a)! - rank.get(b)! ||
      BRANCH_KINDS.indexOf(a.kind) - BRANCH_KINDS.indexOf(b.kind) ||
      b.gameIds.length - a.gameIds.length ||
      a.ply - b.ply,
  );
}

/**
 * `games` (戦法などで絞った対局集合) のうち `name` が指した対局から、分岐点を節に持つ木を作る。
 * 分岐点はこの対局集合だけで求める (findCommonPositions) ので、集合の外の対局との共通局面は混ざらない。
 * 先手・後手で手順が別になるので、本人の側ごとに 1 本。節の親は、その節の対局をすべて含む分岐点のうち最も深いもの。
 */
export function buildBranchTrees(
  games: GameRecord[],
  analyses: Map<string, AnalysisRecord>,
  name: string,
): BranchTree[] {
  const reviewOf = createReviewLookup(analyses);
  return (["black", "white"] as const).flatMap((side) => {
    const list = games.filter((g) => playerSide(g, name) === side);
    const positions = findCommonPositions(list, name);
    const nodes: BranchNode[] = reviewBranches(positions, list, analyses, name).flatMap((r) => {
      const c = candidatesWith(r, list, name, reviewOf);
      if (!c) return [];
      return [
        {
          key: r.key,
          ply: r.ply,
          gameIds: r.gameIds,
          wins: r.wins,
          kind: r.kind,
          opening: r.opening,
          turn: c.turn,
          side: c.side,
          mover: c.mover,
          candidates: c.candidates,
          children: [],
        },
      ];
    });
    if (nodes.length === 0) return [];
    const byPly = [...nodes].sort((a, b) => a.ply - b.ply);
    const roots: BranchNode[] = [];
    for (const n of byPly) {
      const ids = new Set(n.gameIds);
      let parent: BranchNode | undefined;
      for (const p of byPly) {
        if (p.ply >= n.ply) break;
        if (p.gameIds.length > ids.size && n.gameIds.every((id) => p.gameIds.includes(id)))
          parent = p;
      }
      if (!parent) {
        roots.push(n);
        continue;
      }
      parent.children.push(n);
      const via = [...parent.candidates].sort(
        (a, b) =>
          b.gameIds.filter((id) => ids.has(id)).length -
          a.gameIds.filter((id) => ids.has(id)).length,
      )[0];
      if (via && via.gameIds.some((id) => ids.has(id))) n.via = { usi: via.usi, label: via.label };
    }
    return [{ side, roots: sortNodes(roots), size: nodes.length }];
  });
}

/** 木を上から順 (親 → 子) に並べる。depth は根が 0 */
export function flattenBranchTree(roots: BranchNode[]): Array<{ node: BranchNode; depth: number }> {
  const out: Array<{ node: BranchNode; depth: number }> = [];
  const visit = (n: BranchNode, depth: number) => {
    out.push({ node: n, depth });
    for (const c of n.children) visit(c, depth + 1);
  };
  for (const r of roots) visit(r, 0);
  return out;
}
