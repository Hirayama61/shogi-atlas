import type { EndReason, GameRecord, GameResult, GameSummary } from "../core/types";
import { GAME_SHAPE_LABEL } from "../core/opening";

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
  unknown: "",
};

export function describeGame(g: GameSummary | GameRecord): string {
  const parts = [GAME_SHAPE_LABEL[g.opening.shape]];
  if (g.timeControl) parts.push(g.timeControl);
  parts.push(`${g.length}手`);
  const end = END_REASON_LABEL[g.endReason];
  parts.push(end ? `${RESULT_LABEL[g.result]}(${end})` : RESULT_LABEL[g.result]);
  return parts.join(" · ");
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return "日付不明";
  return iso.replace("T", " ").slice(0, 16);
}
