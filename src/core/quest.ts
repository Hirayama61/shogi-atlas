/**
 * 将棋クエストの KIF に特有のメタデータの解釈。
 *
 * 将棋クエストの「棋譜ダウンロード」が出す KIF は
 *   - 棋戦：Shogi Quest
 *   - 先手：name(1605)  のように名前の後ろにレートが付く
 *   - 開始日時が無い (ファイル名にだけ日時がある)
 *   - 終局が「時間切れ」「接続切れ」で書かれ、詰みのときは終局行が無い
 * という形をしている。
 */
import type { EndReason } from "./types";

const RATING_PATTERN = /\s*[（(](\d{3,4})[）)]\s*$/;

/** "name(1605)" のような表記から名前とレートを分離する。 */
export function splitRating(raw: string | undefined): { name: string; rating?: number } {
  const text = (raw ?? "").trim();
  const m = RATING_PATTERN.exec(text);
  if (!m || m[1] === undefined) return { name: text };
  return { name: text.slice(0, m.index).trim(), rating: Number(m[1]) };
}

export function isShogiQuest(tournament: string | undefined, place: string | undefined): boolean {
  return /shogi\s*quest|将棋クエスト/i.test(`${tournament ?? ""} ${place ?? ""}`);
}

/**
 * 将棋クエストが終局として書く行。tsshogi は未知の特殊手 (type: "any") として読むので、
 * 名前から終局理由を引く。どちらも手番側 (その行を指すはずだった側) の負け。
 */
export const QUEST_TERMINAL: Record<string, EndReason> = {
  時間切れ: "timeout",
  接続切れ: "disconnect",
};

/** 画面表示用のレート表記 */
export function formatRating(rating: number | undefined): string | undefined {
  return rating === undefined ? undefined : `R${rating}`;
}
