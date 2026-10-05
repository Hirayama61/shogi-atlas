import type { GameRecord, GameSummary, OpeningInfo } from "./types";

/**
 * 解析ロジックの版。戦法判定などを変えたら上げる。
 * アプリ側はこれが違うデータを「古い」とみなして取り直し、reindex はこれを書き込む。
 */
export const PARSER_VERSION = 2;

export const UNKNOWN_LABEL = "不明";

const DEFAULT_OPENING: OpeningInfo = {
  black: "unknown",
  white: "unknown",
  shape: "unknown",
  blackRookFile: null,
  whiteRookFile: null,
  blackOpening: UNKNOWN_LABEL,
  whiteOpening: UNKNOWN_LABEL,
  blackCastle: UNKNOWN_LABEL,
  whiteCastle: UNKNOWN_LABEL,
};

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v ? v : fallback;
}

function opt(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * データリポジトリや IndexedDB から読んだ古い形のレコードを、現在の型に揃える。
 * 必須の情報 (id, 対局者) が無ければ null。
 */
export function normalizeSummary(raw: unknown): GameSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = opt(r.id);
  if (!id) return null;
  const o = (r.opening && typeof r.opening === "object" ? r.opening : {}) as Partial<OpeningInfo>;
  const opening: OpeningInfo = {
    ...DEFAULT_OPENING,
    ...o,
    blackOpening: str(o.blackOpening, UNKNOWN_LABEL),
    whiteOpening: str(o.whiteOpening, UNKNOWN_LABEL),
    blackCastle: str(o.blackCastle, UNKNOWN_LABEL),
    whiteCastle: str(o.whiteCastle, UNKNOWN_LABEL),
  };
  const source = (
    r.source && typeof r.source === "object" ? r.source : { kind: "paste" }
  ) as GameSummary["source"];
  const s: GameSummary = {
    schema: 1,
    parser: typeof r.parser === "number" ? r.parser : 0,
    id,
    source,
    importedAt: str(r.importedAt, ""),
    format: (opt(r.format) ?? "kif") as GameSummary["format"],
    black: str(r.black, "先手"),
    white: str(r.white, "後手"),
    length: typeof r.length === "number" ? r.length : 0,
    result: (opt(r.result) ?? "unknown") as GameSummary["result"],
    endReason: (opt(r.endReason) ?? "unknown") as GameSummary["endReason"],
    opening,
    tags: strArray(r.tags),
  };
  for (const key of [
    "blackRank",
    "whiteRank",
    "startedAt",
    "endedAt",
    "tournament",
    "place",
    "timeControl",
    "memo",
  ] as const) {
    const v = opt(r[key]);
    if (v) s[key] = v;
  }
  return s;
}

export function normalizeGame(raw: unknown): GameRecord | null {
  const s = normalizeSummary(raw);
  if (!s) return null;
  const r = raw as Record<string, unknown>;
  const rawText = opt(r.raw);
  if (!rawText) return null;
  return {
    ...s,
    raw: rawText,
    usi: str(r.usi, ""),
    positions: strArray(r.positions),
  };
}
