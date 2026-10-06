import { Position, formatMove } from "tsshogi";
import {
  JUDGEMENT_LABEL,
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

export interface BranchMove {
  /** 指した手 (USI) */
  usi: string;
  /** 表示用 (例: ▲6五歩) */
  label: string;
  count: number;
  /** 解析済みの対局での判定。対局ごとに違えば悪い方。解析が無ければ null */
  judgement: Judgement | null;
  /** 最善手 (USI)。指した手が最善なら省略 */
  best?: string;
  /** 最善手の表示用 */
  bestLabel?: string;
  gameIds: string[];
}

export interface BranchReview extends CommonPosition {
  /** 分岐点の局面での手番 */
  turn: Side;
  /** 本人の戦法。対局ごとに違えば局数の多いもの (同数なら名前順で先) */
  opening: string;
  kind: BranchKind;
  /** 本人の手番だった対局で本人が指した手 (回数の多い順) */
  moves: BranchMove[];
}

const SEVERITY: Record<Judgement, number> = { good: 0, inaccuracy: 1, mistake: 2, blunder: 3 };

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
  return formatMove(pos, move)
    .replace("☗", "▲")
    .replace("☖", "△")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
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
  const reviews = new Map<string, Map<number, MoveReview> | null>();
  const reviewOf = (g: GameRecord) => {
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

  return positions.map((p) => {
    const turn: Side = p.ply % 2 === 0 ? "black" : "white";
    const list = p.gameIds.map((id) => byId.get(id)).filter((g) => g !== undefined);
    const opening = majority(
      list.map((g) =>
        playerSide(g, name) === "white" ? g.opening.whiteOpening : g.opening.blackOpening,
      ),
    );
    const moves = new Map<string, BranchMove>();
    let analyzed = false;
    for (const g of list) {
      const review = reviewOf(g);
      if (review) analyzed = true;
      if (playerSide(g, name) !== turn) continue;
      const usi = usiMoves(g.usi)[p.ply];
      if (!usi) continue;
      const m = moves.get(usi) ?? {
        usi,
        label: formatUsiMove(p.key, usi),
        count: 0,
        judgement: null,
        gameIds: [],
      };
      m.count++;
      m.gameIds.push(g.id);
      const r = review?.get(p.ply + 1);
      if (r && r.played === usi) {
        if (m.judgement === null || SEVERITY[r.judgement] > SEVERITY[m.judgement]) {
          m.judgement = r.judgement;
        }
        if (r.best && !m.best) {
          m.best = r.best;
          m.bestLabel = formatUsiMove(p.key, r.best);
        }
      }
      moves.set(usi, m);
    }
    const sorted = Array.from(moves.values()).sort(
      (a, b) => b.count - a.count || a.usi.localeCompare(b.usi),
    );
    const judged = sorted.filter((m) => m.judgement !== null);
    let kind: BranchKind;
    if (!analyzed) kind = "unanalyzed";
    else if (sorted.length === 0) kind = "opponent";
    else if (judged.length === 0) kind = "unanalyzed";
    else if (judged.some((m) => m.judgement !== "good")) kind = "mistake";
    else kind = "correct";
    return { ...p, turn, opening, kind, moves: sorted };
  });
}

export interface BranchOpeningGroup {
  opening: string;
  /** 空の分類は含めない。順序は BRANCH_KINDS */
  kinds: Array<{ kind: BranchKind; positions: BranchReview[] }>;
  total: number;
}

/**
 * 本人の戦法 × 分類でまとめる。戦法は分岐点の数の多い順 (同数なら名前順)。
 * 分類の中では元の順 (局数・手数の多い順) を保つ。
 */
export function groupBranchReviews(reviews: BranchReview[]): BranchOpeningGroup[] {
  const groups = new Map<string, Map<BranchKind, BranchReview[]>>();
  for (const r of reviews) {
    const g = groups.get(r.opening) ?? new Map<BranchKind, BranchReview[]>();
    const list = g.get(r.kind) ?? [];
    list.push(r);
    g.set(r.kind, list);
    groups.set(r.opening, g);
  }
  return Array.from(groups)
    .map(([opening, kinds]) => {
      const list = BRANCH_KINDS.filter((k) => kinds.has(k)).map((kind) => ({
        kind,
        positions: kinds.get(kind)!,
      }));
      return { opening, kinds: list, total: list.reduce((n, k) => n + k.positions.length, 0) };
    })
    .sort((a, b) => b.total - a.total || a.opening.localeCompare(b.opening));
}

/** 本人の手 1 つの表示 (例: ▲6五歩 ×2 (悪手, 最善 ▲4五歩)) */
export function describeBranchMove(m: BranchMove): string {
  let note: string;
  if (m.judgement === null) note = "未解析";
  else if (m.judgement === "good") note = "最善";
  else
    note = m.bestLabel
      ? `${JUDGEMENT_LABEL[m.judgement]}, 最善 ${m.bestLabel}`
      : JUDGEMENT_LABEL[m.judgement];
  return `${m.label} ×${m.count} (${note})`;
}
