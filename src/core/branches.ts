import { Position, formatMove, type ImmutablePosition, type Move } from "tsshogi";
import {
  isAnalysisStale,
  reviewMoves,
  type AnalysisRecord,
  type Judgement,
  type MoveReview,
} from "./analysis";
import { playerSide, type CommonPosition, type Side } from "./stats";
import type { GameRecord } from "./types";

/**
 * 分岐点 (findCommonPositions) で本人が何を指し、エンジンから見てどうだったかをまとめる。
 * 分岐点も判定も読み出し時に計算し、GameRecord には何も足さない。
 */

/** 分岐点の分類。mistake = 悪手を指した、correct = 正しく指せた、opponent = 相手の選択、unanalyzed = 未解析 */
export type BranchKind = "mistake" | "correct" | "opponent" | "unanalyzed";

export const BRANCH_KINDS: BranchKind[] = ["mistake", "correct", "opponent", "unanalyzed"];

export const BRANCH_KIND_LABEL: Record<BranchKind, string> = {
  mistake: "悪手を指した分岐",
  correct: "正しく指せた分岐",
  opponent: "相手の選択で分かれた分岐",
  unanalyzed: "未解析",
};

export interface BranchReview extends CommonPosition {
  /** 分岐点の局面での手番 */
  turn: Side;
  /** 本人の戦法。対局ごとに違えば局数の多いもの (同数なら名前順で先) */
  opening: string;
  kind: BranchKind;
}

export const SEVERITY: Record<Judgement, number> = {
  good: 0,
  inaccuracy: 1,
  mistake: 2,
  blunder: 3,
};

export function usiMoves(usi: string): string[] {
  const i = usi.indexOf(" moves ");
  return i < 0
    ? []
    : usi
        .slice(i + " moves ".length)
        .split(/\s+/)
        .filter(Boolean);
}

/**
 * USI の手を局面キー (または手数つきの SFEN) の局面で日本語表記にする (例: ▲6五歩)。
 * 表記できなければ USI のまま。
 */
export function formatUsiMove(key: string, usi: string): string {
  const sfen = key.trim().split(/\s+/).length >= 4 ? key : `${key} 1`;
  const pos = Position.newBySFEN(sfen);
  const move = pos?.createMoveByUSI(usi);
  if (!pos || !move || !pos.isValidMove(move)) return usi;
  return formatPositionMove(pos, move);
}

/** 局面と手から表示用の表記 (例: ▲6五歩) を作る */
export function formatPositionMove(pos: ImmutablePosition, move: Move, lastMove?: Move): string {
  return formatMove(pos, move, lastMove ? { lastMove } : undefined)
    .replace("☗", "▲")
    .replace("☖", "△")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * 対局ごとの手の評価 (手数 → MoveReview) を引く関数。解析が無いか古ければ null。
 * 同じ対局を何度引いても reviewMoves は 1 回だけ。
 */
export function createReviewLookup(
  analyses: Map<string, AnalysisRecord>,
): (g: GameRecord) => Map<number, MoveReview> | null {
  const reviews = new Map<string, Map<number, MoveReview> | null>();
  return (g) => {
    if (!reviews.has(g.id)) {
      const a = analyses.get(g.id);
      reviews.set(
        g.id,
        a && !isAnalysisStale(g, a)
          ? new Map(reviewMoves(g, a).map((m) => [m.ply, m] as const))
          : null,
      );
    }
    return reviews.get(g.id)!;
  };
}

function majority(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const sorted = Array.from(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return sorted[0]?.[0] ?? "不明";
}

/**
 * 分岐点ごとに本人の手を集計して分類する。
 * - 解析済み (古くない) の対局が 1 局も通っていなければ unanalyzed
 * - 本人の手番の対局が無ければ opponent
 * - 本人の手のうち解析済みのものに 1 つでも最善以外 (疑問手・悪手・大悪手) があれば mistake、すべて最善なら correct
 * - 本人の手番だが解析済みの対局の手が無ければ unanalyzed
 */
export function reviewBranches(
  positions: CommonPosition[],
  games: GameRecord[],
  analyses: Map<string, AnalysisRecord>,
  name: string,
): BranchReview[] {
  const byId = new Map(games.map((g) => [g.id, g] as const));
  const reviewOf = createReviewLookup(analyses);

  return positions.map((p) => {
    const turn: Side = p.ply % 2 === 0 ? "black" : "white";
    const list = p.gameIds.map((id) => byId.get(id)).filter((g) => g !== undefined);
    const opening = majority(
      list.map((g) =>
        playerSide(g, name) === "white" ? g.opening.whiteOpening : g.opening.blackOpening,
      ),
    );
    // 本人が指した手ごとの判定 (解析済みの対局のみ。対局ごとに違えば悪い方)
    const moves = new Map<string, Judgement | null>();
    let analyzed = false;
    for (const g of list) {
      const review = reviewOf(g);
      if (review) analyzed = true;
      if (playerSide(g, name) !== turn) continue;
      const usi = usiMoves(g.usi)[p.ply];
      if (!usi) continue;
      const r = review?.get(p.ply + 1);
      const prev = moves.get(usi) ?? null;
      moves.set(
        usi,
        r && r.played === usi && (prev === null || SEVERITY[r.judgement] > SEVERITY[prev])
          ? r.judgement
          : prev,
      );
    }
    const judged = Array.from(moves.values()).filter((j) => j !== null);
    let kind: BranchKind;
    if (!analyzed) kind = "unanalyzed";
    else if (moves.size === 0) kind = "opponent";
    else if (judged.length === 0) kind = "unanalyzed";
    else if (judged.some((j) => j !== "good")) kind = "mistake";
    else kind = "correct";
    return { ...p, turn, opening, kind };
  });
}
