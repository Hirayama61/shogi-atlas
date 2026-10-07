import type { EndReason, GameRecord, GameResult, GameSummary, SideStyle } from "../core/types";
import { JUDGEMENT_LABEL, MATE_CP, type Judgement } from "../core/analysis";
import type { BranchCandidate } from "../core/branchStudy";
import { shortOpeningLabel, SIDE_STYLE_LABEL } from "../core/opening";
import { matchesPortfolio } from "../core/portfolio";
import { formatRating } from "../core/quest";
import { SELF_NAME } from "../core/self";
import { serviceOf } from "../core/source";
import type { StyleQuadrant } from "../core/styles";
import { outcomeFor, playerSide } from "../core/stats";
import type { ListQuery, PortfolioFilter, ResultFilter, SideFilter } from "./router";

export const RESULT_LABEL: Record<GameResult, string> = {
  black: "先手勝ち",
  white: "後手勝ち",
  draw: "引き分け",
  unknown: "不明",
};

export const END_REASON_LABEL: Record<EndReason, string> = {
  resign: "投了",
  timeout: "時間切れ",
  mate: "詰み",
  repetition: "千日手",
  impass: "持将棋",
  draw: "引き分け",
  foul: "反則",
  enteringKing: "入玉宣言",
  default: "不戦",
  interrupt: "中断",
  disconnect: "接続切れ",
  try: "トライ",
  unknown: "",
};

export function describeGame(g: GameSummary | GameRecord): string {
  const parts = [shortOpeningLabel(g.opening)];
  parts.push(`${g.length}手`);
  if (g.timeControl) parts.push(g.timeControl);
  const result = RESULT_LABEL[g.result] ?? RESULT_LABEL.unknown;
  const end = END_REASON_LABEL[g.endReason] ?? "";
  parts.push(end ? `${result}(${end})` : result);
  return parts.join(" · ");
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return "日付不明";
  return iso.replace("T", " ").slice(0, 16);
}

export function fmtCp(cp: number): string {
  if (cp >= MATE_CP) return "先手勝勢 (詰み)";
  if (cp <= -MATE_CP) return "後手勝勢 (詰み)";
  return cp > 0 ? `+${cp}` : `${cp}`;
}

/**
 * 戦法・囲いの名前を、指定した側 (省けば先手・後手の両方) で取り出す。
 * self / opponent は対局者を指定していて、その人の対局のときだけ意味を持つ (それ以外は両方)。
 */
function sideValues(
  g: GameSummary,
  side: SideFilter | undefined,
  player: string | undefined,
  black: string,
  white: string,
): string[] {
  if (side === "black") return [black];
  if (side === "white") return [white];
  const ps = player && (side === "self" || side === "opponent") ? playerSide(g, player) : null;
  if (ps) return (ps === "black") === (side === "self") ? [black] : [white];
  return [black, white];
}

export function openingValues(g: GameSummary, q: ListQuery): string[] {
  return sideValues(g, q.openingSide, q.player, g.opening.blackOpening, g.opening.whiteOpening);
}

export function castleValues(g: GameSummary, q: ListQuery): string[] {
  return sideValues(g, q.castleSide, q.player, g.opening.blackCastle, g.opening.whiteCastle);
}

function matchesResult(g: GameSummary, result: ResultFilter, player: string | undefined): boolean {
  if (result === "black" || result === "white") return g.result === result;
  if (result === "other") return g.result === "draw" || g.result === "unknown";
  // 対局者を指定していなければ勝ち / 負けは効かせない
  if (!player) return true;
  const side = playerSide(g, player);
  return side !== null && outcomeFor(g.result, side) === result;
}

function matchesSelfStyle(g: GameSummary, player: string, style: SideStyle): boolean {
  const side = playerSide(g, player);
  return side !== null && g.opening[side] === style;
}

function matchesVsOpening(g: GameSummary, player: string, opening: string): boolean {
  const side = playerSide(g, player);
  if (side === null) return false;
  return (side === "black" ? g.opening.whiteOpening : g.opening.blackOpening) === opening;
}

/** 棋譜一覧の絞り込み条件をすべて満たすか */
export function matchesQuery(g: GameSummary, q: ListQuery): boolean {
  if (q.player && playerSide(g, q.player) === null) return false;
  if (q.service && serviceOf(g) !== q.service) return false;
  if (q.shape && g.opening.shape !== q.shape) return false;
  if (q.selfStyle && q.player && !matchesSelfStyle(g, q.player, q.selfStyle)) return false;
  if (q.selfSide && q.player && playerSide(g, q.player) !== q.selfSide) return false;
  if (q.opening && !openingValues(g, q).includes(q.opening)) return false;
  if (q.vsOpening && q.player && !matchesVsOpening(g, q.player, q.vsOpening)) return false;
  if (q.castle && !castleValues(g, q).includes(q.castle)) return false;
  if (q.result && !matchesResult(g, q.result, q.player)) return false;
  return true;
}

/** 戦型ポートフォリオの行 (あれば) と絞り込み条件の両方を満たすか */
export function matchesListRoute(
  g: GameSummary,
  query: ListQuery = {},
  portfolio?: PortfolioFilter,
): boolean {
  if (portfolio && !matchesPortfolio(g, portfolio.player, portfolio.condition)) return false;
  return matchesQuery(g, query);
}

/** 選択肢: 名前と局数 (局数の多い順) */
export function countValues(
  games: GameSummary[],
  valuesOf: (g: GameSummary) => string[],
): Array<{ value: string; games: number }> {
  const counts = new Map<string, number>();
  for (const g of games) {
    for (const v of new Set(valuesOf(g))) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return Array.from(counts, ([value, n]) => ({ value, games: n })).sort(
    (a, b) => b.games - a.games || a.value.localeCompare(b.value),
  );
}

export const SIDE_LABEL = { black: "先手", white: "後手" } as const;

/** 対局者の表示名: 名前に段位・レートを添える (例: "taro 二段 R1500")。自分には添えない */
export function playerLabel(g: GameSummary | GameRecord, side: "black" | "white"): string {
  const parts = [g[side]];
  if (g[side] === SELF_NAME) return g[side];
  const rank = side === "black" ? g.blackRank : g.whiteRank;
  const rating = side === "black" ? g.blackRating : g.whiteRating;
  if (rank) parts.push(rank);
  const r = formatRating(rating);
  if (r) parts.push(r);
  return parts.join(" ");
}

/** 対局者ページの見出し。自分のページは「マイページ」 */
export function pageTitle(name: string): string {
  return name === SELF_NAME ? "マイページ" : name;
}

/** 名前に添える段位・レート。自分 (マイページ・一覧・共有画像) には出さない */
export function shownRank(name: string, rank: string | undefined): string | undefined {
  return name === SELF_NAME ? undefined : rank || undefined;
}

/** 戦型ポートフォリオの条件の見出し (例: "先手 / 相手: 居飛車") */
export function portfolioConditionLabel(side: "black" | "white", vsStyle: SideStyle): string {
  return `${SIDE_LABEL[side]} / 相手: ${SIDE_STYLE_LABEL[vsStyle]}`;
}

/** 棋譜一覧の上に出す、戦型ポートフォリオの行の説明 */
export function describePortfolio(filter: PortfolioFilter): { label: string; value: string } {
  const c = filter.condition;
  return {
    label: `${portfolioConditionLabel(c.side, c.vsStyle)} (${c.vsOpening ?? "すべて"})`,
    value: `${c.opening} + ${c.castle}`,
  };
}

/** 候補手の判定を盤の印・文字の色に */
export function judgementTone(j: Judgement | null): "good" | "bad" | "none" {
  if (j === null) return "none";
  return j === "good" ? "good" : "bad";
}

/** 候補手の判定の短い表示 (例: 悪手 · 損失 400 · 最善 ▲1六歩) */
export function describeCandidate(c: BranchCandidate): string {
  if (c.judgement === null) return "未解析";
  if (c.judgement === "good") return "最善";
  const parts = [JUDGEMENT_LABEL[c.judgement]];
  if (c.loss !== null) parts.push(`損失 ${c.loss}`);
  if (c.bestLabel) parts.push(`最善 ${c.bestLabel}`);
  return parts.join(" · ");
}

/** 対局者ページの 4 区分の見出し */
export const STYLE_QUADRANT_LABEL: Record<StyleQuadrant, string> = {
  aiIbisha: "相居飛車",
  ibishaVsFuri: "対抗形 · 自分が居飛車",
  furiVsIbisha: "対抗形 · 自分が振り飛車",
  aiFuribisha: "相振り飛車",
  unknown: "戦型不明",
};

/** 区分の補足 (自分 × 相手) */
export const STYLE_QUADRANT_NOTE: Record<StyleQuadrant, string> = {
  aiIbisha: "自分 居飛車 × 相手 居飛車",
  ibishaVsFuri: "自分 居飛車 × 相手 振り飛車",
  furiVsIbisha: "自分 振り飛車 × 相手 居飛車",
  aiFuribisha: "自分 振り飛車 × 相手 振り飛車",
  unknown: "どちらかの戦型が判定できなかった対局",
};

/** 区分の対局を棋譜一覧の絞り込み条件で表す */
export function quadrantQuery(player: string, quadrant: StyleQuadrant): ListQuery {
  switch (quadrant) {
    case "aiIbisha":
      return { player, shape: "aiIbisha" };
    case "ibishaVsFuri":
      return { player, shape: "taikokei", selfStyle: "ibisha" };
    case "furiVsIbisha":
      return { player, shape: "taikokei", selfStyle: "furibisha" };
    case "aiFuribisha":
      return { player, shape: "aiFuribisha" };
    case "unknown":
      return { player, shape: "unknown" };
  }
}
