import { Color } from "tsshogi";

/**
 * SFEN から手数を取り除いた局面キー。
 * 盤面・手番・持ち駒が同じなら同じキーになるので、対局をまたいだ完全一致局面の検索に使う。
 */
export function positionKey(sfen: string): string {
  const parts = sfen.trim().split(/\s+/);
  return parts.slice(0, 3).join(" ");
}

export interface BoardPiece {
  file: number; // 1-9
  rank: number; // 1-9
  /** SFEN の駒文字 (例: "P", "+r") */
  piece: string;
}

/** SFEN の盤面部分を駒の配列に展開する。 */
export function parseBoardSfen(boardSfen: string): BoardPiece[] {
  const pieces: BoardPiece[] = [];
  const rows = boardSfen.split("/");
  rows.forEach((row, rankIndex) => {
    let file = 9;
    let promoted = false;
    for (const ch of row) {
      if (ch === "+") {
        promoted = true;
        continue;
      }
      if (ch >= "1" && ch <= "9") {
        file -= Number(ch);
        continue;
      }
      pieces.push({ file, rank: rankIndex + 1, piece: promoted ? `+${ch}` : ch });
      promoted = false;
      file -= 1;
    }
  });
  return pieces;
}

/** 指定した色の飛車 (龍を含む) がある筋。見つからなければ null。 */
export function rookFile(positionSfen: string, color: Color): number | null {
  const board = positionSfen.split(/\s+/)[0] ?? "";
  const target = color === Color.BLACK ? "R" : "r";
  for (const p of parseBoardSfen(board)) {
    if (p.piece === target || p.piece === `+${target}`) {
      return p.file;
    }
  }
  return null;
}
