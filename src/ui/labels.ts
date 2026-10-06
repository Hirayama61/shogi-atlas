import type { EndReason, GameRecord, GameResult, GameSummary, SideStyle } from "../core/types";
import { MATE_CP } from "../core/analysis";
import { shortOpeningLabel, SIDE_STYLE_LABEL } from "../core/opening";
import { matchesPortfolio } from "../core/portfolio";
import { serviceOf } from "../core/source";
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

/** 棋譜一覧の絞り込み条件をすべて満たすか */
export function matchesQuery(g: GameSummary, q: ListQuery): boolean {
  if (q.player && playerSide(g, q.player) === null) return false;
  if (q.service && serviceOf(g) !== q.service) return false;
  if (q.shape && g.opening.shape !== q.shape) return false;
  if (q.opening && !openingValues(g, q).includes(q.opening)) return false;
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
