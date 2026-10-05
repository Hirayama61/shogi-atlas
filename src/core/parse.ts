import {
  Color,
  Position,
  Record,
  RecordFormatType,
  RecordMetadataKey,
  SpecialMoveType,
  detectRecordFormat,
  importCSA,
  importJKFString,
  importKI2,
  importKIF,
  isKnownSpecialMove,
  type ImmutableNode,
  type ImmutableRecord,
} from "tsshogi";
import { sha256Hex } from "./hash";
import { isCheckmated } from "./mate";
import { classifyOpening } from "./opening";
import { PARSER_VERSION } from "./normalize";
import { positionKey } from "./position";
import { QUEST_TERMINAL, isShogiQuest, splitRating } from "./quest";
import type { EndReason, GameRecord, GameResult, GameSource, KifuFormat } from "./types";
import { isShogiWars, normalizeDatetime, splitPlayerName, warsTimeControl } from "./wars";

export class KifuParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KifuParseError";
  }
}

export interface ParseOptions {
  source: GameSource;
  importedAt?: string;
  tags?: string[];
  memo?: string;
}

/**
 * 前後の空白や BOM、CRLF を正規化する。
 * KIF の「同　銀」は全角空白が正式だが、貼り付け経路で半角になったり消えたりするので揃える
 * (tsshogi は「同 銀」を特殊手「同」と読んでしまい、そこで手順が途切れる)。
 */
export function normalizeKifuText(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/^(\s*\d+\s+)同[ \t]*(?=[歩香桂銀金角飛玉王と杏圭全馬龍竜成])/gm, "$1同\u3000")
    .trim();
}

/**
 * テキストから棋譜を読み込む。KIF / KI2 / CSA / USI / JKF を自動判別する。
 */
export function importRecord(text: string): { record: Record; format: KifuFormat } {
  const data = normalizeKifuText(text);
  if (!data) throw new KifuParseError("棋譜が空です");

  const detected = detectRecordFormat(data);
  const attempts: Array<[KifuFormat, () => Record | Error]> = [];
  const push = (format: KifuFormat, fn: () => Record | Error) => {
    if (!attempts.some(([f]) => f === format)) attempts.push([format, fn]);
  };

  switch (detected) {
    case RecordFormatType.KIF:
      push("kif", () => importKIF(data));
      break;
    case RecordFormatType.KI2:
      push("ki2", () => importKI2(data));
      break;
    case RecordFormatType.CSA:
      push("csa", () => importCSA(data));
      break;
    case RecordFormatType.USI:
    case RecordFormatType.SFEN:
      push("usi", () => Record.newByUSI(data));
      break;
    case RecordFormatType.JKF:
      push("jkf", () => importJKFString(data));
      break;
  }
  // 判定が外れた場合の保険
  push("kif", () => importKIF(data));
  push("ki2", () => importKI2(data));
  push("csa", () => importCSA(data));
  push("usi", () => Record.newByUSI(data));

  let lastError: Error | undefined;
  for (const [format, fn] of attempts) {
    const result = fn();
    if (result instanceof Error) {
      lastError = result;
      continue;
    }
    if (countMoves(result) === 0 && format !== "usi") {
      lastError = new Error("指し手がありません");
      continue;
    }
    return { record: result, format };
  }
  throw new KifuParseError(`棋譜を解釈できませんでした: ${lastError?.message ?? "unknown"}`);
}

function countMoves(record: ImmutableRecord): number {
  let n = 0;
  record.forEach((node) => {
    if (node.ply > 0 && !isSpecial(node)) n++;
  });
  return n;
}

function isSpecial(node: ImmutableNode): boolean {
  return !("usi" in node.move);
}

/**
 * 棋譜テキストを GameRecord に変換する。
 */
export async function parseKifu(text: string, opts: ParseOptions): Promise<GameRecord> {
  const raw = normalizeKifuText(text);
  const { record, format } = importRecord(raw);
  const meta = record.metadata;
  const get = (key: RecordMetadataKey) => meta.getStandardMetadata(key)?.trim() || undefined;

  const positions: string[] = [];
  let length = 0;
  let last: ImmutableNode | undefined;
  let lastSfen = "";
  record.forEach((node) => {
    if (node.ply === 0) {
      positions.push(positionKey(node.sfen));
      lastSfen = node.sfen;
      return;
    }
    if (isSpecial(node)) {
      last = node;
      return;
    }
    positions.push(positionKey(node.sfen));
    lastSfen = node.sfen;
    length++;
    last = node;
  });

  const black = parsePlayer(
    get(RecordMetadataKey.BLACK_NAME) ?? get(RecordMetadataKey.SHITATE_NAME),
  );
  const white = parsePlayer(get(RecordMetadataKey.WHITE_NAME) ?? get(RecordMetadataKey.UWATE_NAME));
  // CSA の $EVENT は tsshogi では title に入るので、棋戦が無ければそちらを使う
  const tournament = get(RecordMetadataKey.TOURNAMENT) ?? get(RecordMetadataKey.TITLE);
  const place = get(RecordMetadataKey.PLACE);
  const startedAt = normalizeDatetime(
    get(RecordMetadataKey.START_DATETIME) ?? get(RecordMetadataKey.DATE),
  );
  const endedAt = normalizeDatetime(get(RecordMetadataKey.END_DATETIME));
  let { result, endReason } = judgeResult(last, raw);
  if (result === "unknown" && endReason === "unknown" && length > 0) {
    // 終局行が無い棋譜 (将棋クエストの詰みなど) は最終局面が詰みかどうかで判定する
    const mated = judgeMate(lastSfen);
    if (mated) ({ result, endReason } = mated);
  }
  const usi = record.getUSI({ allMoves: true });

  const id = (await sha256Hex([usi, black.name, white.name, startedAt ?? ""].join("|"))).slice(
    0,
    16,
  );

  const game: GameRecord = {
    schema: 1,
    parser: PARSER_VERSION,
    id,
    source: opts.source,
    importedAt: opts.importedAt ?? new Date().toISOString(),
    format,
    raw,
    black: black.name || "先手",
    white: white.name || "後手",
    length,
    result,
    endReason,
    usi,
    positions,
    opening: classifyOpening(positions),
    tags: dedupe(opts.tags ?? []),
  };
  if (black.rank) game.blackRank = black.rank;
  if (white.rank) game.whiteRank = white.rank;
  if (black.rating !== undefined) game.blackRating = black.rating;
  if (white.rating !== undefined) game.whiteRating = white.rating;
  if (startedAt) game.startedAt = startedAt;
  if (endedAt) game.endedAt = endedAt;
  if (tournament) game.tournament = tournament;
  if (place) game.place = place;
  const timeControl = warsTimeControl(tournament) ?? get(RecordMetadataKey.TIME_LIMIT);
  if (timeControl) game.timeControl = timeControl;
  if (isShogiWars(tournament, place)) game.tags = dedupe([...game.tags, "将棋ウォーズ"]);
  if (isShogiQuest(tournament, place)) game.tags = dedupe([...game.tags, "将棋クエスト"]);
  if (opts.memo?.trim()) game.memo = opts.memo.trim();
  return game;
}

/** "name 二段" (将棋ウォーズ) や "name(1605)" (将棋クエスト) から名前・段級位・レートを分離する。 */
function parsePlayer(raw: string | undefined): { name: string; rank?: string; rating?: number } {
  const { name, rating } = splitRating(raw);
  const split = splitPlayerName(name);
  const out: { name: string; rank?: string; rating?: number } = { name: split.name };
  if (split.rank) out.rank = split.rank;
  if (rating !== undefined) out.rating = rating;
  return out;
}

/** 最終局面が詰みなら手番側の負け */
function judgeMate(sfen: string): { result: GameResult; endReason: EndReason } | undefined {
  const position = Position.newBySFEN(sfen);
  if (!position || !isCheckmated(position)) return undefined;
  return { result: other(position.color), endReason: "mate" };
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items.map((s) => s.trim()).filter(Boolean)));
}

function other(color: Color): GameResult {
  return color === Color.BLACK ? "white" : "black";
}

function self(color: Color): GameResult {
  return color === Color.BLACK ? "black" : "white";
}

/**
 * 最終ノードの特殊手から勝敗を判定する。取れなければ KIF 末尾の「まで○手で先手の勝ち」を見る。
 */
export function judgeResult(
  last: ImmutableNode | undefined,
  raw: string,
): { result: GameResult; endReason: EndReason } {
  if (last && isSpecial(last) && isKnownSpecialMove(last.move)) {
    // 特殊手のノードでは局面が変わらないので nextColor が「その手を指すはずだった側」
    const side = last.nextColor;
    switch (last.move.type) {
      case SpecialMoveType.RESIGN:
        return { result: other(side), endReason: "resign" };
      case SpecialMoveType.TIMEOUT:
        return { result: other(side), endReason: "timeout" };
      case SpecialMoveType.MATE:
        return { result: other(side), endReason: "mate" };
      case SpecialMoveType.FOUL_LOSE:
        return { result: other(side), endReason: "foul" };
      case SpecialMoveType.FOUL_WIN:
        return { result: self(side), endReason: "foul" };
      case SpecialMoveType.ENTERING_OF_KING:
        return { result: self(side), endReason: "enteringKing" };
      case SpecialMoveType.WIN_BY_DEFAULT:
        return { result: self(side), endReason: "default" };
      case SpecialMoveType.LOSE_BY_DEFAULT:
        return { result: other(side), endReason: "default" };
      case SpecialMoveType.REPETITION_DRAW:
        return { result: "draw", endReason: "repetition" };
      case SpecialMoveType.IMPASS:
        return { result: "draw", endReason: "impass" };
      case SpecialMoveType.DRAW:
        return { result: "draw", endReason: "draw" };
      case SpecialMoveType.INTERRUPT:
        return { result: "unknown", endReason: "interrupt" };
      default:
        break;
    }
  }
  if (last && isSpecial(last) && "name" in last.move) {
    // 将棋クエストの「時間切れ」「接続切れ」。tsshogi は未知の特殊手として名前だけ保持する
    const endReason = QUEST_TERMINAL[last.move.name.trim()];
    if (endReason) return { result: other(last.nextColor), endReason };
  }
  const m = /(先手|後手|下手|上手)の(勝ち|反則勝ち)/.exec(raw);
  if (m) {
    const winnerBlack = m[1] === "先手" || m[1] === "下手";
    return {
      result: winnerBlack ? "black" : "white",
      endReason: m[2] === "反則勝ち" ? "foul" : "unknown",
    };
  }
  if (/千日手/.test(raw)) return { result: "draw", endReason: "repetition" };
  if (/持将棋/.test(raw)) return { result: "draw", endReason: "impass" };
  return { result: "unknown", endReason: "unknown" };
}

/**
 * 1 つのテキストに複数の棋譜が "---" 区切りで貼られている場合に分割する。
 */
export function splitKifuBlocks(text: string): string[] {
  return normalizeKifuText(text)
    .split(/\n\s*(?:-{3,}|={3,}|\*{3,})\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export { exportKIF } from "tsshogi";
