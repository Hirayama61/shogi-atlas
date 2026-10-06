/**
 * 対局の出典サービス (将棋ウォーズ / 将棋クエスト) の判定。
 * 一覧のバッジ表示と絞り込みの両方がここを使う。DOM には依存しない。
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

/** 絞り込み欄の入力がこの文字列を含めばそのサービスに絞る (小文字で比較) */
const SERVICE_KEYWORDS: Record<Exclude<Service, "other">, string[]> = {
  wars: ["ウォーズ", "wars"],
  quest: ["クエスト", "quest"],
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

/**
 * 絞り込みの入力 (小文字化済み) が指すサービス。
 * 「ウォーズ」「クエスト」のような語を含むときだけ返し、それ以外は null。
 */
export function serviceFromQuery(query: string): Service | null {
  const q = query.toLowerCase();
  for (const service of Object.keys(SERVICE_KEYWORDS) as (keyof typeof SERVICE_KEYWORDS)[]) {
    if (SERVICE_KEYWORDS[service].some((k) => q.includes(k))) return service;
  }
  return null;
}
