import type { GameSummary } from "./types";

/**
 * 自分の複数 ID (将棋ウォーズ・将棋クエストなど) を 1 人にまとめるための名前。
 * データリポジトリで `自分` ラベルを付けた Issue のタイトルが自分の ID 一覧 (`index.json` の `self`) になり、
 * 集計・表示の前に対局者名とタグの ID をこの名前に置き換える。元の KIF (保存されている `raw`) は書き換えない。
 */
export const SELF_NAME = "自分";

/** データリポジトリの Issue に付けるラベル。タグとしても `SELF_NAME` と同じ文字列になる */
export const SELF_LABEL = "自分";

/** `index.json` の `self` などから ID 一覧を取り出す (重複と空を除いて並べる) */
export function normalizeSelfIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const ids = v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
  return Array.from(new Set(ids.map((x) => x.trim()))).sort();
}

const HEADER_RE = /^(先手|後手|下手|上手)([：:])(.*)$/;
const CSA_NAME_RE = /^(N[+-])(.*)$/;

/** KIF / CSA の対局者名の行だけ、自分の ID を `SELF_NAME` にする (表示・コピー用) */
export function maskSelfInKifu(raw: string, ids: ReadonlySet<string>): string {
  if (ids.size === 0) return raw;
  return raw
    .split("\n")
    .map((line) => {
      const body = line.replace(/\r$/, "");
      const cr = body.length < line.length ? "\r" : "";
      const h = HEADER_RE.exec(body) ?? CSA_NAME_RE.exec(body);
      if (!h) return line;
      const head = h.length === 4 ? `${h[1]}${h[2]}` : h[1]!;
      const value = h[h.length - 1]!;
      if (ids.has(value.trim())) return `${head}${SELF_NAME}${cr}`;
      // 将棋ウォーズは「先手：名前 二段」のように段級位が続く
      const m = /^(\s*)(\S+)(\s.*)$/.exec(value);
      if (m && ids.has(m[2]!)) return `${head}${m[1]}${SELF_NAME}${m[3]}${cr}`;
      return line;
    })
    .join("\n");
}

type Named = Pick<GameSummary, "black" | "white" | "tags"> & { raw?: string };

/**
 * 自分の ID を `SELF_NAME` に置き換えた対局を返す。どちらかが自分なら `SELF_NAME` をタグに足す
 * (相手の Issue 経由で取り込んだ対局でも、自分を登録した対局者として数えるため)。
 * 置き換えるものが無ければ同じオブジェクトを返す。
 */
export function applySelf<T extends Named>(g: T, ids: ReadonlySet<string>): T {
  if (ids.size === 0) return g;
  const black = ids.has(g.black);
  const white = ids.has(g.white);
  const tagHit = g.tags.some((t) => ids.has(t));
  if (!black && !white && !tagHit) return g;
  const tags = g.tags.map((t) => (ids.has(t) ? SELF_NAME : t));
  if (black || white) tags.push(SELF_NAME);
  const out: T = {
    ...g,
    black: black ? SELF_NAME : g.black,
    white: white ? SELF_NAME : g.white,
    tags: Array.from(new Set(tags)),
  };
  if (typeof g.raw === "string") out.raw = maskSelfInKifu(g.raw, ids);
  return out;
}
