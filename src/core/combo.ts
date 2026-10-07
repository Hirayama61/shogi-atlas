import { reviewMoves, isAnalysisStale, type AnalysisRecord } from "./analysis";
import { firstCapturePly, mirror, toBoardView } from "./board";
import { matchCastle } from "./castle";
import { UNKNOWN_LABEL } from "./normalize";
import { outcomeFor, playerSide, type Bucket, type Outcome, type Side } from "./stats";
import type { GameRecord } from "./types";

/**
 * 戦法と囲いの組み合わせ分析。対局者ごとに次を集計する。
 * - 自分の (戦法 × 囲い)。解析済みなら平均損失も
 * - 攻め開始時 (最初の駒交換) の自分の囲いの成熟度
 * - (自分の戦法 × 相手の囲い)
 * - 相手の囲い
 * 戦法・囲いが判定できない対局は「不明」として数える。
 */

export interface LossBucket extends Bucket {
  /** 解析済みの対局数 */
  analyzed: number;
  /** 解析済みの対局での本人の 1 手あたりの平均損失 (cp)。解析済みが無ければ null */
  averageLoss: number | null;
}

export interface ComboBucket extends LossBucket {
  /** 組み合わせの 1 つ目 (戦法) */
  first: string;
  /** 組み合わせの 2 つ目 (囲い) */
  second: string;
}

/**
 * 攻め開始時の囲いの成熟度。
 * - mature: 最初の駒交換の直前の局面で、本人の囲いがどれかの型に駒まで全部一致している
 * - immature: 一致する型が無い、または型の駒が欠けている (未成熟)
 * - noCapture: 駒交換が一度も無かった
 */
export type CastleMaturity = "mature" | "immature" | "noCapture";

export const CASTLE_MATURITY_LABEL: Record<CastleMaturity, string> = {
  mature: "完成",
  immature: "未成熟",
  noCapture: "駒交換なし",
};

export interface MaturityAtCapture {
  maturity: CastleMaturity;
  /** 最初の駒交換の手数 */
  ply: number | null;
  /** そのとき一致した囲い (未完成でも最も近いもの)。無ければ null */
  castle: string | null;
}

/** 最初の駒交換の直前の局面で、指定した側の囲いが完成しているか */
export function castleMaturityAtFirstCapture(positions: string[], side: Side): MaturityAtCapture {
  const ply = firstCapturePly(positions);
  if (ply === null) return { maturity: "noCapture", ply: null, castle: null };
  const key = positions[ply - 1]!;
  const view = side === "black" ? toBoardView(key) : mirror(toBoardView(key));
  const m = matchCastle(view);
  const mature = !!m && m.matched === m.total;
  return { maturity: mature ? "mature" : "immature", ply, castle: m?.name ?? null };
}

export interface ComboStats {
  name: string;
  /** 全体の解析済みの対局数 */
  analyzed: number;
  /** 全体の本人の 1 手あたりの平均損失 (cp)。解析済みが無ければ null */
  averageLoss: number | null;
  /** 自分の囲い (平均損失つき) */
  castles: LossBucket[];
  /** 1. 自分の戦法 × 自分の囲い */
  openingCastle: ComboBucket[];
  /** 2. 攻め開始時の自分の囲いの成熟度 (name は CASTLE_MATURITY_LABEL) */
  maturity: Bucket[];
  /** 3. 自分の戦法 × 相手の囲い */
  openingVsCastle: ComboBucket[];
  /** 4. 相手の囲い */
  vsCastles: Bucket[];
}

function label(v: string | undefined): string {
  return v ? v : UNKNOWN_LABEL;
}

function count(b: Bucket, outcome: Outcome): void {
  b.games++;
  if (outcome === "win") b.wins++;
  if (outcome === "loss") b.losses++;
}

type Loss = { loss: number; moves: number };
type LossAcc<T extends LossBucket> = T & Loss;
type ComboAcc = LossAcc<ComboBucket>;

function addLoss(b: LossAcc<LossBucket>, outcome: Outcome, loss: Loss | null): void {
  count(b, outcome);
  if (loss) {
    b.analyzed++;
    b.loss += loss.loss;
    b.moves += loss.moves;
  }
}

function emptyLoss(name: string): LossAcc<LossBucket> {
  return { name, games: 0, wins: 0, losses: 0, analyzed: 0, averageLoss: null, loss: 0, moves: 0 };
}

function bumpCombo(
  map: Map<string, ComboAcc>,
  first: string,
  second: string,
  outcome: Outcome,
  loss: Loss | null,
): void {
  const name = `${first} × ${second}`;
  const b = map.get(name) ?? { ...emptyLoss(name), first, second };
  addLoss(b, outcome, loss);
  map.set(name, b);
}

function bumpLoss(
  map: Map<string, LossAcc<LossBucket>>,
  name: string,
  outcome: Outcome,
  loss: Loss | null,
): void {
  const b = map.get(name) ?? emptyLoss(name);
  addLoss(b, outcome, loss);
  map.set(name, b);
}

function bump(map: Map<string, Bucket>, name: string, outcome: Outcome): void {
  const b = map.get(name) ?? { name, games: 0, wins: 0, losses: 0 };
  count(b, outcome);
  map.set(name, b);
}

function byGames<T extends Bucket>(a: T, b: T): number {
  return b.games - a.games || a.name.localeCompare(b.name);
}

function finishLoss<T extends LossBucket>(acc: LossAcc<T>): T {
  const { loss, moves, ...b } = acc;
  const out: LossBucket = {
    ...b,
    averageLoss: b.analyzed && moves ? Math.round(loss / moves) : null,
  };
  return out as T;
}

function finishCombo<T extends LossBucket>(map: Map<string, LossAcc<T>>): T[] {
  return Array.from(map.values()).map(finishLoss).sort(byGames);
}

/** 本人の手の損失の合計と手数。解析が無いか古ければ null */
function ownLoss(game: GameRecord, side: Side, analysis: AnalysisRecord | undefined): Loss | null {
  if (!analysis || isAnalysisStale(game, analysis)) return null;
  const mine = reviewMoves(game, analysis).filter((m) => m.side === side);
  return { loss: mine.reduce((a, m) => a + m.loss, 0), moves: mine.length };
}

/**
 * 対局者の戦法 × 囲いの組み合わせを集計する。positions を使うので GameRecord が必要。
 * analyses を渡すと (戦法 × 囲い)・囲い・全体に平均損失を付ける。
 * 区分や戦法で絞った対局を渡せば、その範囲の集計になる。
 */
export function computeComboStats(
  all: GameRecord[],
  name: string,
  analyses: Map<string, AnalysisRecord> = new Map(),
): ComboStats {
  const openingCastle = new Map<string, ComboAcc>();
  const openingVsCastle = new Map<string, ComboAcc>();
  const maturity = new Map<string, Bucket>();
  const vsCastles = new Map<string, Bucket>();
  const castles = new Map<string, LossAcc<LossBucket>>();
  const total = emptyLoss("");

  for (const g of all) {
    const side = playerSide(g, name);
    if (!side) continue;
    const outcome = outcomeFor(g.result, side);
    const black = side === "black";
    const own = label(black ? g.opening.blackOpening : g.opening.whiteOpening);
    const ownCastle = label(black ? g.opening.blackCastle : g.opening.whiteCastle);
    const theirCastle = label(black ? g.opening.whiteCastle : g.opening.blackCastle);

    const loss = ownLoss(g, side, analyses.get(g.id));
    bumpCombo(openingCastle, own, ownCastle, outcome, loss);
    bumpLoss(castles, ownCastle, outcome, loss);
    addLoss(total, outcome, loss);
    bumpCombo(openingVsCastle, own, theirCastle, outcome, null);
    bump(vsCastles, theirCastle, outcome);
    const m = castleMaturityAtFirstCapture(g.positions, side);
    bump(maturity, CASTLE_MATURITY_LABEL[m.maturity], outcome);
  }

  const { analyzed, averageLoss } = finishLoss(total);
  return {
    name,
    analyzed,
    averageLoss,
    castles: finishCombo(castles),
    openingCastle: finishCombo(openingCastle),
    maturity: Array.from(maturity.values()).sort(byGames),
    openingVsCastle: finishCombo(openingVsCastle),
    vsCastles: Array.from(vsCastles.values()).sort(byGames),
  };
}
