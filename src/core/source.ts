/**
 * 対局の出典サービス (将棋ウォーズ / 将棋クエスト) の判定。
 * 一覧のバッジ表示がここを使う。DOM には依存しない。
 */
import { isShogiQuest } from "./quest";
import type { GameRecord, GameSummary } from "./types";
import { isShogiWars } from "./wars";

export type Service = "wars" | "quest" | "other";

/** バッジに出す短い名前 */
export const SERVICE_LABEL: Record<Service, string> = {
  wars: "ウォーズ",
  quest: "クエスト",
  other: "",
};

/** `tournament` / `place` / タグから出典サービスを判定する。 */
export function serviceOf(
  game: Pick<GameSummary | GameRecord, "tournament" | "place" | "tags">,
): Service {
  const tags = game.tags ?? [];
  if (isShogiWars(game.tournament, game.place) || tags.includes("将棋ウォーズ")) return "wars";
  if (isShogiQuest(game.tournament, game.place) || tags.includes("将棋クエスト")) return "quest";
  return "other";
}
