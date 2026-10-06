import {
  bishopsOnBoard,
  fileOf,
  firstCapturePly,
  has,
  inHand,
  mirror,
  toBoardView,
  type BoardView,
} from "./board";
import { detectCastle, fallbackCastleLabel } from "./castle";
import type { GameShape, OpeningInfo, SideStyle } from "./types";

/** 戦法判定に使う最大手数 */
const OPENING_PLIES = 40;
/** 囲い判定に使う最大手数 (囲いは戦法より遅れて完成する) */
const CASTLE_PLIES = 80;
/** 7五歩をこの手数以内に突いた三間飛車は早石田 (自分の 4 手目まで) */
const HAYAISHIDA_PLIES = 8;
/** これより短い対局は判定しない */
const MIN_PLIES_FOR_JUDGE = 12;

export const UNKNOWN = "不明";

interface SideFeatures {
  style: SideStyle;
  /** 飛車が序盤で最も長く居た筋 (振り飛車なら 5 以上) */
  rookFile: number | null;
  /** 振り飛車として採用した筋 (5=中飛車 6=四間 7=三間 8=向かい) */
  furiFile: number | null;
  /** 角交換型か (対局の最初の駒交換が角交換)。仕掛けの途中で起きた角交換は含めない */
  bishopExchange: boolean;
  /** 横歩を取ったか (飛車が 3四 に来たか) */
  yokofu: boolean;
  /** 飛車先の歩を 5 段目まで伸ばしたか */
  rookPawnAdvanced: boolean;
  /** 石田流 (三間飛車 + 7五歩) */
  ishida: boolean;
  /** 早石田 (三間飛車 + 8 手目以内に 7五歩) */
  hayaishida: boolean;
  castle: string;
}

/**
 * 角交換型か: 序盤の最初の駒交換が角交換 (最初に取られた駒が角で、直後に角を取り返して両者が角を持つ)。
 * 仕掛けの結果として後から起きた角交換は戦法の選択ではないので含めない。
 */
function isBishopExchangeOpening(positions: string[], views: BoardView[]): boolean {
  const ply = firstCapturePly(positions);
  if (ply === null || ply + 1 > OPENING_PLIES) return false;
  const before = views[ply - 1];
  const taken = views[ply];
  const retaken = views[ply + 1];
  if (!before || !taken || !retaken) return false;
  return (
    bishopsOnBoard(taken) < bishopsOnBoard(before) &&
    bishopsOnBoard(retaken) === 0 &&
    inHand(retaken, "B") &&
    inHand(retaken, "b")
  );
}

/** 先手視点に揃えた局面列から片側の特徴を取る */
function sideFeatures(views: BoardView[], bishopExchange: boolean): SideFeatures {
  const plies = Math.min(views.length - 1, OPENING_PLIES);
  const fileCount = new Map<number, number>();
  let yokofu = false;
  let rookPawnAdvanced = false;
  let pawn75 = false;
  let earlyPawn75 = false;

  for (let ply = 1; ply <= plies; ply++) {
    const v = views[ply];
    if (!v) continue;
    const f = fileOf(v, "R");
    if (f !== null) fileCount.set(f, (fileCount.get(f) ?? 0) + 1);
    if (has(v, 3, 4, "R")) yokofu = true;
    if (ply <= 20 && has(v, 2, 5, "P")) rookPawnAdvanced = true;
    if (has(v, 7, 5, "P")) {
      pawn75 = true;
      if (ply <= HAYAISHIDA_PLIES) earlyPawn75 = true;
    }
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
  // 「右玉」は居飛車の用語。振り飛車側で同じ形なら玉の位置で表す
  let castleName = castle?.name ?? fallbackCastleLabel(views, CASTLE_PLIES);
  if (style === "furibisha" && castleName === "右玉")
    castleName = fallbackCastleLabel(views, CASTLE_PLIES);
  return {
    style,
    rookFile,
    furiFile,
    bishopExchange,
    yokofu,
    rookPawnAdvanced,
    ishida: furiFile === 7 && pawn75,
    hayaishida: furiFile === 7 && earlyPawn75,
    castle: castleName,
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
  // 早石田の角交換は仕掛けの一部なので「角交換」を付けない
  if (f.hayaishida) return "早石田";
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
  const bishopExchange = isBishopExchangeOpening(positions, blackViews);
  const black = sideFeatures(blackViews, bishopExchange);
  const white = sideFeatures(whiteViews, bishopExchange);

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
  if (o.shape === "unknown" || !o.blackOpening || !o.whiteOpening) return UNKNOWN;
  if (o.blackOpening === UNKNOWN || o.whiteOpening === UNKNOWN) return UNKNOWN;
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
