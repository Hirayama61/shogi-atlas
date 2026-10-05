/**
 * 将棋ウォーズの KIF に特有のメタデータの解釈。
 */

const RANK_PATTERN = /\s+((?:\d+|[一二三四五六七八九十]+)(?:級|段))$/;

/** "name 二段" のような表記から名前と段級位を分離する。 */
export function splitPlayerName(raw: string | undefined): { name: string; rank?: string } {
  const text = (raw ?? "").trim();
  const m = RANK_PATTERN.exec(text);
  if (!m || m[1] === undefined) return { name: text };
  return { name: text.slice(0, m.index).trim(), rank: m[1] };
}

/** "将棋ウォーズ(10分)" や "将棋ウォーズ(10分切れ負け)" → "10分"。"3分" / "10秒" も同様。 */
export function warsTimeControl(tournament: string | undefined): string | undefined {
  if (!tournament) return undefined;
  const m = /将棋ウォーズ\s*[（(](.+?)[）)]/.exec(tournament);
  const inner = m?.[1]?.trim();
  if (!inner) return undefined;
  return /^\d+\s*(分|秒)/.exec(inner)?.[0]?.replace(/\s+/g, "") ?? inner;
}

export function isShogiWars(tournament: string | undefined, place: string | undefined): boolean {
  return /将棋ウォーズ/.test(tournament ?? "") || /将棋ウォーズ/.test(place ?? "");
}

/**
 * "2024/06/17 10:05:15" や "2024-06-17 10:05" を "YYYY-MM-DDTHH:mm:ss" に揃える。
 * 解釈できなければ元の文字列を返す。
 */
export function normalizeDatetime(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
    raw.trim(),
  );
  if (!m) return raw.trim();
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = m;
  const pad = (v: string) => v.padStart(2, "0");
  return `${y}-${pad(mo!)}-${pad(d!)}T${pad(h)}:${mi}:${s}`;
}
