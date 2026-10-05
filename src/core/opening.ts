import { Color } from "tsshogi";
import type { GameShape, OpeningInfo, SideStyle } from "./types";
import { rookFile } from "./position";

/** 序盤判定に使う最大手数 */
const OPENING_PLIES = 40;
/** これより短い対局は戦型を判定しない */
const MIN_PLIES_FOR_JUDGE = 12;

/**
 * 飛車の位置から居飛車 / 振り飛車を判定する最初の実装。
 * 先手の飛車が 5 筋以上、後手の飛車が 5 筋以下に動いたら振り飛車とみなす。
 * (右四間飛車などは居飛車側に入る。細かい戦法名の判定は後で足す。)
 */
export function classifyOpening(positions: string[]): OpeningInfo {
  const plies = Math.min(positions.length - 1, OPENING_PLIES);
  let blackRookFile: number | null = null;
  let whiteRookFile: number | null = null;
  let blackMax = 2;
  let whiteMin = 8;

  for (let ply = 1; ply <= plies; ply++) {
    const sfen = positions[ply];
    if (!sfen) continue;
    const b = rookFile(sfen, Color.BLACK);
    const w = rookFile(sfen, Color.WHITE);
    if (b !== null && b > blackMax) {
      blackMax = b;
      blackRookFile = b;
    }
    if (w !== null && w < whiteMin) {
      whiteMin = w;
      whiteRookFile = w;
    }
  }

  if (plies < MIN_PLIES_FOR_JUDGE) {
    return { black: "unknown", white: "unknown", shape: "unknown", blackRookFile, whiteRookFile };
  }

  const black: SideStyle = blackMax >= 5 ? "furibisha" : "ibisha";
  const white: SideStyle = whiteMin <= 5 ? "furibisha" : "ibisha";
  return { black, white, shape: shapeOf(black, white), blackRookFile, whiteRookFile };
}

function shapeOf(black: SideStyle, white: SideStyle): GameShape {
  if (black === "unknown" || white === "unknown") return "unknown";
  if (black === "ibisha" && white === "ibisha") return "aiIbisha";
  if (black === "furibisha" && white === "furibisha") return "aiFuribisha";
  return "taikokei";
}

export const SIDE_STYLE_LABEL: Record<SideStyle, string> = {
  ibisha: "居飛車",
  furibisha: "振り飛車",
  unknown: "不明",
};

export const GAME_SHAPE_LABEL: Record<GameShape, string> = {
  aiIbisha: "相居飛車",
  taikokei: "対抗形",
  aiFuribisha: "相振り飛車",
  unknown: "不明",
};
