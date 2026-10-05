import { bishopsOnBoard, fileOf, has, inHand, mirror, toBoardView, type BoardView } from "./board";
import { detectCastle } from "./castle";
import type { GameShape, OpeningInfo, SideStyle } from "./types";

/** 戦法判定に使う最大手数 */
const OPENING_PLIES = 40;
/** 囲い判定に使う最大手数 (囲いは戦法より遅れて完成する) */
const CASTLE_PLIES = 80;
/** これより短い対局は判定しない */
const MIN_PLIES_FOR_JUDGE = 12;

export const UNKNOWN = "不明";

interface SideFeatures {
  style: SideStyle;
  /** 飛車が序盤で最も長く居た筋 (振り飛車なら 5 以上) */
  rookFile: number | null;
  /** 振り飛車として採用した筋 (5=中飛車 6=四間 7=三間 8=向かい) */
  furiFile: number | null;
  /** 序盤 40 手以内に角交換が成立したか */
  bishopExchange: boolean;
  /** 横歩を取ったか (飛車が 3四 に来たか) */
  yokofu: boolean;
  /** 飛車先の歩を 5 段目まで伸ばしたか */
  rookPawnAdvanced: boolean;
  /** 石田流 (三間飛車 + 7五歩) */
  ishida: boolean;
  castle: string;
}

/** 先手視点に揃えた局面列から片側の特徴を取る */
function sideFeatures(views: BoardView[]): SideFeatures {
  const plies = Math.min(views.length - 1, OPENING_PLIES);
  const fileCount = new Map<number, number>();
  let bishopExchange = false;
  let yokofu = false;
  let rookPawnAdvanced = false;
  let pawn75 = false;

  for (let ply = 1; ply <= plies; ply++) {
    const v = views[ply];
    if (!v) continue;
    const f = fileOf(v, "R");
    if (f !== null) fileCount.set(f, (fileCount.get(f) ?? 0) + 1);
    if (bishopsOnBoard(v) === 0 && inHand(v, "B") && inHand(v, "b")) bishopExchange = true;
    if (has(v, 3, 4, "R")) yokofu = true;
    if (ply <= 20 && has(v, 2, 5, "P")) rookPawnAdvanced = true;
    if (has(v, 7, 5, "P")) pawn75 = true;
  }

  // 振り飛車の筋: 5 筋以上に居た手数が最も多い筋
  let furiFile: number | null = null;
  let furiCount = 0;
  let rookFile: number | null = null;
  let rookCount = 0;
  for (const [file, count] of fileCount) {
    if (count > rookCount) {
      rookCount = count;
      rookFile = file;
    }
    if (file >= 5 && count > furiCount) {
      furiCount = count;
      furiFile = file;
    }
  }
  // 1 手だけ通過したような筋は採用しない
  if (furiFile !== null && furiCount < 2) furiFile = null;

  const castle = detectCastle(views, CASTLE_PLIES);
  const style: SideStyle =
    plies < MIN_PLIES_FOR_JUDGE ? "unknown" : furiFile !== null ? "furibisha" : "ibisha";
  return {
    style,
    rookFile,
    furiFile,
    bishopExchange,
    yokofu,
    rookPawnAdvanced,
    ishida: furiFile === 7 && pawn75,
    castle: castle?.name ?? UNKNOWN,
  };
}

const FURI_NAME: Record<number, string> = {
  5: "中飛車",
  6: "四間飛車",
  7: "三間飛車",
  8: "向かい飛車",
  9: "向かい飛車",
};

function furibishaName(f: SideFeatures): string {
  const base = f.ishida ? "石田流三間飛車" : (FURI_NAME[f.furiFile ?? 0] ?? "振り飛車");
  return f.bishopExchange ? `角交換${base}` : base;
}

function ibishaName(self: SideFeatures, opponent: SideFeatures, bothIbisha: boolean): string {
  if (self.rookFile === 4) return "右四間飛車";
  if (!bothIbisha) {
    if (/穴熊/.test(self.castle)) return "居飛車穴熊";
    if (/左美濃|天守閣/.test(self.castle)) return "左美濃";
    return "居飛車";
  }
  if (self.yokofu || opponent.yokofu) return "横歩取り";
  if (self.bishopExchange) return "角換わり";
  if (self.rookPawnAdvanced && opponent.rookPawnAdvanced) return "相掛かり";
  if (/矢倉/.test(self.castle)) return "矢倉";
  if (/雁木/.test(self.castle)) return "雁木";
  return "居飛車";
}

/**
 * 局面キー列から戦法と囲いを判定する。
 */
export function classifyOpening(positions: string[]): OpeningInfo {
  const blackViews = positions.map(toBoardView);
  const whiteViews = blackViews.map(mirror);
  const black = sideFeatures(blackViews);
  const white = sideFeatures(whiteViews);

  const info: OpeningInfo = {
    black: black.style,
    white: white.style,
    shape: shapeOf(black.style, white.style),
    blackRookFile: black.furiFile,
    whiteRookFile: white.furiFile === null ? null : 10 - white.furiFile,
    blackOpening: UNKNOWN,
    whiteOpening: UNKNOWN,
    blackCastle: black.castle,
    whiteCastle: white.castle,
  };
  if (info.shape === "unknown") return info;

  const bothIbisha = info.shape === "aiIbisha";
  info.blackOpening =
    black.style === "furibisha" ? furibishaName(black) : ibishaName(black, white, bothIbisha);
  info.whiteOpening =
    white.style === "furibisha" ? furibishaName(white) : ibishaName(white, black, bothIbisha);
  return info;
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

/** 一覧表示用の短い戦型名。相居飛車なら共通の戦法名、対抗形なら振り飛車側の戦法名。 */
export function shortOpeningLabel(o: OpeningInfo): string {
  if (o.shape === "unknown") return "不明";
  if (o.shape === "aiIbisha") {
    return o.blackOpening === o.whiteOpening
      ? o.blackOpening
      : `${o.blackOpening} / ${o.whiteOpening}`;
  }
  if (o.shape === "aiFuribisha") return `相振り (${o.blackOpening} / ${o.whiteOpening})`;
  const furi = o.black === "furibisha" ? o.blackOpening : o.whiteOpening;
  const side = o.black === "furibisha" ? "☗" : "☖";
  return `${side}${furi}`;
}
