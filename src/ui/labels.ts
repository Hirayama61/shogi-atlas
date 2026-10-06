import type { EndReason, GameRecord, GameResult, GameSummary, SideStyle } from "../core/types";
import { MATE_CP } from "../core/analysis";
import { shortOpeningLabel, SIDE_STYLE_LABEL } from "../core/opening";
import { matchesPortfolio } from "../core/portfolio";
import { playerSide } from "../core/stats";
import type { GameFilter, GameFilterField } from "./router";

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

export const FILTER_FIELD_LABEL: Record<GameFilterField, string> = {
  opening: "採用戦法",
  castle: "囲い",
  vsOpening: "相手の戦法",
};

/** 対局者ページの集計 (computePlayerStats) と同じ見方で、その対局者の対局かつ該当の戦法・囲いか */
export function matchesFilter(g: GameSummary, filter: GameFilter): boolean {
  if (filter.field === "portfolio") return matchesPortfolio(g, filter.player, filter.condition);
  const side = playerSide(g, filter.player);
  if (side === null) return false;
  const o = g.opening;
  const value =
    filter.field === "opening"
      ? side === "black"
        ? o.blackOpening
        : o.whiteOpening
      : filter.field === "castle"
        ? side === "black"
          ? o.blackCastle
          : o.whiteCastle
        : side === "black"
          ? o.whiteOpening
          : o.blackOpening;
  return value === filter.value;
}

export const SIDE_LABEL = { black: "先手", white: "後手" } as const;

/** 戦型ポートフォリオの条件の見出し (例: "先手 / 相手: 居飛車") */
export function portfolioConditionLabel(side: "black" | "white", vsStyle: SideStyle): string {
  return `${SIDE_LABEL[side]} / 相手: ${SIDE_STYLE_LABEL[vsStyle]}`;
}

/** 棋譜一覧の上に出す絞り込みの説明 */
export function describeFilter(filter: GameFilter): { label: string; value: string } {
  if (filter.field !== "portfolio") {
    return { label: FILTER_FIELD_LABEL[filter.field], value: filter.value };
  }
  const c = filter.condition;
  return {
    label: `${portfolioConditionLabel(c.side, c.vsStyle)} (${c.vsOpening ?? "すべて"})`,
    value: `${c.opening} + ${c.castle}`,
  };
}
