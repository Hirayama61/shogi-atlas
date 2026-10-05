/**
 * 棋譜データの共通スキーマ。
 * PWA (IndexedDB) と shogi-atlas-data リポジトリ (games/<id>.json) の両方で同じ形を使う。
 */

export type KifuFormat = "kif" | "ki2" | "csa" | "usi" | "jkf";

export type GameResult = "black" | "white" | "draw" | "unknown";

export type EndReason =
  | "resign"
  | "timeout"
  | "mate"
  | "repetition"
  | "impass"
  | "draw"
  | "foul"
  | "enteringKing"
  | "default"
  | "interrupt"
  | "disconnect"
  | "try"
  | "unknown";

/** 片側の戦型の大分類 */
export type SideStyle = "ibisha" | "furibisha" | "unknown";

/** 両者の組み合わせ */
export type GameShape = "aiIbisha" | "taikokei" | "aiFuribisha" | "unknown";

export interface OpeningInfo {
  black: SideStyle;
  white: SideStyle;
  shape: GameShape;
  /** 序盤 (40手以内) で飛車が最も振られた筋。先手は 2 から増える方向、後手は 8 から減る方向。 */
  blackRookFile: number | null;
  whiteRookFile: number | null;
  /** 戦法名 (例: "四間飛車", "角換わり", "居飛車")。判定できなければ "不明"。 */
  blackOpening: string;
  whiteOpening: string;
  /** 囲い名 (例: "本美濃", "居飛車穴熊")。判定できなければ "不明"。 */
  blackCastle: string;
  whiteCastle: string;
}

export interface GameSource {
  kind: "paste" | "issue" | "url" | "file";
  /** 出典 URL (将棋ウォーズのブラウザ版 URL など) */
  url?: string;
  /** shogi-atlas-data の Issue 番号 */
  issue?: number;
  /** Issue コメントから取り込んだ場合のコメント ID */
  comment?: number;
}

export interface GameRecord {
  schema: 1;
  /** 解析ロジックの版 (normalize.ts の PARSER_VERSION)。古いものはアプリ側で取り直す。 */
  parser: number;
  /** USI 手順 + 対局者 + 開始日時から導出する安定 ID */
  id: string;
  source: GameSource;
  /** ISO 8601 */
  importedAt: string;
  format: KifuFormat;
  /** 取り込んだ元テキストそのまま */
  raw: string;
  black: string;
  white: string;
  /** 段級位。将棋ウォーズの KIF から取れた場合のみ */
  blackRank?: string;
  whiteRank?: string;
  /** レート。将棋クエストの KIF から取れた場合のみ */
  blackRating?: number;
  whiteRating?: number;
  /** "YYYY-MM-DDTHH:mm:ss" (タイムゾーンなし、対局地のローカル時刻) */
  startedAt?: string;
  endedAt?: string;
  tournament?: string;
  place?: string;
  /** 将棋ウォーズの持ち時間区分 ("10分" / "3分" / "10秒") など */
  timeControl?: string;
  /** 実際の指し手の数 (投了などの特殊手は含まない) */
  length: number;
  result: GameResult;
  endReason: EndReason;
  /** "position startpos moves ..." 形式 */
  usi: string;
  /** 各手数での局面キー (手数を除いた SFEN)。index 0 が開始局面。 */
  positions: string[];
  opening: OpeningInfo;
  tags: string[];
  memo?: string;
}

/** 一覧表示用。raw / positions / usi を省いた軽量版。 */
export type GameSummary = Omit<GameRecord, "raw" | "positions" | "usi">;

export interface GameIndex {
  schema: 1;
  updatedAt: string;
  games: GameSummary[];
}

export function toSummary(game: GameRecord): GameSummary {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { raw, positions, usi, ...summary } = game;
  return summary;
}
