import { type BoardView, has } from "./board";

/**
 * 囲いの判定。先手視点のパターンを定義し、後手は盤を回して同じものを使う。
 * 玉の位置は必須。それ以外の駒は一致数で採点し、完成に近いものを採用する。
 */
export interface CastlePattern {
  name: string;
  king: [number, number];
  /** [file, rank, piece]。piece は "G" "S" "L" など。 */
  pieces: Array<[number, number, string]>;
  /** 玉以外で最低何枚一致すれば候補にするか */
  minMatch: number;
}

// 具体的なものを先に並べ、同点なら先に書いたものを優先する
export const CASTLES: CastlePattern[] = [
  {
    name: "銀冠",
    king: [2, 8],
    pieces: [
      [2, 7, "S"],
      [3, 8, "G"],
      [4, 7, "G"],
    ],
    minMatch: 3,
  },
  {
    name: "高美濃",
    king: [2, 8],
    pieces: [
      [3, 8, "S"],
      [4, 7, "G"],
      [5, 8, "G"],
    ],
    minMatch: 3,
  },
  {
    name: "本美濃",
    king: [2, 8],
    pieces: [
      [3, 8, "S"],
      [4, 9, "G"],
      [5, 8, "G"],
    ],
    minMatch: 3,
  },
  {
    name: "片美濃",
    king: [2, 8],
    pieces: [
      [3, 8, "S"],
      [4, 9, "G"],
    ],
    minMatch: 2,
  },
  {
    name: "振り飛車穴熊",
    king: [1, 9],
    pieces: [
      [1, 8, "L"],
      [2, 8, "S"],
      [3, 9, "G"],
      [3, 8, "G"],
    ],
    minMatch: 3,
  },
  {
    name: "居飛車穴熊",
    king: [9, 9],
    pieces: [
      [9, 8, "L"],
      [8, 8, "S"],
      [7, 9, "G"],
      [6, 8, "G"],
    ],
    minMatch: 3,
  },
  {
    name: "居飛車穴熊",
    king: [9, 9],
    pieces: [
      [9, 8, "L"],
      [8, 8, "S"],
      [7, 9, "G"],
      [7, 8, "G"],
    ],
    minMatch: 3,
  },
  {
    name: "天守閣美濃",
    king: [8, 7],
    pieces: [
      [7, 8, "S"],
      [6, 9, "G"],
      [5, 8, "G"],
    ],
    minMatch: 2,
  },
  {
    name: "左美濃",
    king: [8, 8],
    pieces: [
      [7, 8, "S"],
      [6, 9, "G"],
      [5, 8, "G"],
    ],
    minMatch: 2,
  },
  {
    name: "金矢倉",
    king: [8, 8],
    pieces: [
      [7, 8, "G"],
      [6, 7, "G"],
      [7, 7, "S"],
    ],
    minMatch: 3,
  },
  {
    name: "矢倉",
    king: [8, 8],
    pieces: [
      [7, 8, "G"],
      [7, 7, "S"],
    ],
    minMatch: 2,
  },
  {
    name: "矢倉",
    king: [7, 9],
    pieces: [
      [7, 8, "G"],
      [6, 7, "G"],
      [7, 7, "S"],
    ],
    minMatch: 3,
  },
  {
    name: "雁木",
    king: [6, 9],
    pieces: [
      [6, 7, "S"],
      [5, 7, "S"],
      [7, 8, "G"],
      [5, 8, "G"],
    ],
    minMatch: 3,
  },
  {
    name: "雁木",
    king: [7, 9],
    pieces: [
      [6, 7, "S"],
      [5, 7, "S"],
      [7, 8, "G"],
      [5, 8, "G"],
    ],
    minMatch: 3,
  },
  {
    name: "雁木",
    king: [6, 8],
    pieces: [
      [6, 7, "S"],
      [5, 7, "S"],
      [7, 8, "G"],
      [5, 8, "G"],
    ],
    minMatch: 3,
  },
  {
    name: "エルモ囲い",
    king: [7, 9],
    pieces: [
      [7, 8, "G"],
      [6, 8, "S"],
      [5, 8, "G"],
    ],
    minMatch: 2,
  },
  {
    name: "舟囲い",
    king: [7, 8],
    pieces: [
      [6, 9, "G"],
      [5, 8, "G"],
      [6, 8, "S"],
    ],
    minMatch: 2,
  },
  {
    name: "中住まい",
    king: [5, 8],
    pieces: [
      [4, 8, "G"],
      [6, 8, "G"],
      [3, 8, "S"],
      [7, 8, "S"],
    ],
    minMatch: 2,
  },
  {
    name: "金無双",
    king: [3, 8],
    pieces: [
      [4, 9, "G"],
      [5, 8, "G"],
      [2, 8, "S"],
    ],
    minMatch: 2,
  },
  {
    name: "金無双",
    king: [2, 8],
    pieces: [
      [3, 9, "G"],
      [4, 8, "G"],
      [3, 8, "S"],
    ],
    minMatch: 2,
  },
];

export interface CastleMatch {
  name: string;
  matched: number;
  total: number;
  ply: number;
}

export function matchCastle(view: BoardView): CastleMatch | null {
  let best: CastleMatch | null = null;
  for (const c of CASTLES) {
    if (!has(view, c.king[0], c.king[1], "K")) continue;
    const matched = c.pieces.filter(([f, r, p]) => has(view, f, r, p)).length;
    if (matched < c.minMatch) continue;
    const score = matched / c.pieces.length;
    if (
      !best ||
      score > best.matched / best.total ||
      (score === best.matched / best.total && matched > best.matched)
    ) {
      best = { name: c.name, matched, total: c.pieces.length, ply: 0 };
    }
  }
  return best;
}

/**
 * 局面列 (先手視点に揃えたもの) から囲いを決める。
 * 完成度が最も高い局面を採用し、同点なら早い手数のものを採る。
 */
export function detectCastle(views: BoardView[], maxPly: number): CastleMatch | null {
  let best: CastleMatch | null = null;
  const end = Math.min(views.length - 1, maxPly);
  for (let ply = 1; ply <= end; ply++) {
    const view = views[ply];
    if (!view) continue;
    const m = matchCastle(view);
    if (!m) continue;
    const score = m.matched / m.total;
    const bestScore = best ? best.matched / best.total : -1;
    if (score > bestScore || (score === bestScore && m.matched > (best?.matched ?? 0))) {
      best = { ...m, ply };
    }
  }
  return best;
}
