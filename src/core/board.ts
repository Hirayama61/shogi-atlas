import { parseBoardSfen } from "./position";

/**
 * 局面キー (手数なし SFEN) を扱いやすい形にしたもの。
 * 戦法・囲いの判定は先手視点で書き、後手は盤を 180 度回して同じ判定を使う。
 */
export interface BoardView {
  /** "<file><rank>" → SFEN の駒文字 (先手は大文字)。例: "28" → "R" */
  pieces: Map<string, string>;
  /** 先手番なら "b" */
  turn: string;
  /** 持ち駒の SFEN 文字列 ("-" なら無し) */
  hands: string;
}

export function toBoardView(positionKey: string): BoardView {
  const [board = "", turn = "b", hands = "-"] = positionKey.split(/\s+/);
  const pieces = new Map<string, string>();
  for (const p of parseBoardSfen(board)) pieces.set(`${p.file}${p.rank}`, p.piece);
  return { pieces, turn, hands };
}

/** 盤を 180 度回し、先後の駒を入れ替える。後手の判定を先手用のルールで行うために使う。 */
export function mirror(view: BoardView): BoardView {
  const pieces = new Map<string, string>();
  for (const [key, piece] of view.pieces) {
    const file = Number(key[0]);
    const rank = Number(key[1]);
    pieces.set(`${10 - file}${10 - rank}`, swapCase(piece));
  }
  return { pieces, turn: view.turn === "b" ? "w" : "b", hands: swapCase(view.hands) };
}

function swapCase(s: string): string {
  return s.replace(/[a-zA-Z]/g, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()));
}

/** 先手 (大文字) の駒が指定マスにあるか。promoted を省略すると成・不成を問わない。 */
export function has(view: BoardView, file: number, rank: number, piece: string): boolean {
  const p = view.pieces.get(`${file}${rank}`);
  if (!p) return false;
  return p === piece || p === `+${piece}`;
}

/** 先手の駒 (成も含む) がある筋を返す。無ければ null。 */
export function fileOf(view: BoardView, piece: string): number | null {
  for (const [key, p] of view.pieces) {
    if (p === piece || p === `+${piece}`) return Number(key[0]);
  }
  return null;
}

/** 先手の持ち駒に指定の駒があるか */
export function inHand(view: BoardView, piece: string): boolean {
  return view.hands !== "-" && view.hands.includes(piece);
}

/** 盤上に角 (馬を含む) が残っているか (先後問わず) */
export function bishopsOnBoard(view: BoardView): number {
  let n = 0;
  for (const p of view.pieces.values()) if (/^\+?[bB]$/.test(p)) n++;
  return n;
}

/** 盤上の駒の数 (先後問わず) */
export function piecesOnBoard(positionKey: string): number {
  return toBoardView(positionKey).pieces.size;
}

/**
 * 最初の駒交換 (攻め開始) の手数。駒が初めて取られた手 = 盤上の駒が前の局面より減った手。
 * positions は局面キー列 (index 0 が開始局面)。駒を取る手が無ければ null。
 * 戦法判定 (角交換型など) と組み合わせ分析で同じ定義を使う。
 */
export function firstCapturePly(positions: string[]): number | null {
  let prev = positions[0] === undefined ? 0 : piecesOnBoard(positions[0]);
  for (let ply = 1; ply < positions.length; ply++) {
    const key = positions[ply];
    if (key === undefined) continue;
    const n = piecesOnBoard(key);
    if (n < prev) return ply;
    prev = n;
  }
  return null;
}
