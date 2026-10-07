import {
  bishopsOnBoard,
  fileOf,
  firstCapturePly,
  has,
  inHand,
  mirror,
  squareOf,
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
/** 横歩を取る (3四飛) のはこの手数まで。これより後に 3四 に来たのは中盤の飛車の転回 */
const YOKOFU_PLIES = 30;
/** これより短い対局は判定しない */
const MIN_PLIES_FOR_JUDGE = 12;

export const UNKNOWN = "不明";

export interface SideFeatures {
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

  // 振り飛車 = 自陣の 8 段目で飛車を 4 筋以下から 5 筋以上へ横に動かした (振った)。
  // 相掛かり・横歩取りの浮き飛車や、浮いた飛車の中盤の転回は振ったことにしない。
  let prevSquare = views[0] ? squareOf(views[0], "R") : null;
  let swung = false;
  /** 振る前に飛車が 8 段目を離れていた (浮いていた) 手数 */
  let floatedBeforeSwing = 0;
  /** 振ったあとに飛車が 5 筋以上に居た手数 (筋ごと) */
  const furiCountByFile = new Map<number, number>();
  for (let ply = 1; ply <= plies; ply++) {
    const v = views[ply];
    if (!v) continue;
    const square = squareOf(v, "R");
    if (square) {
      const [file, rank] = square;
      fileCount.set(file, (fileCount.get(file) ?? 0) + 1);
      // 駒を取りながらの横移動 (8 段目に入った駒を飛車で取る) は振ったことにしない
      const prevView = views[ply - 1];
      if (!swung && prevSquare && prevSquare[1] === 8 && rank === 8 && prevView)
        swung = prevSquare[0] <= 4 && file >= 5 && !prevView.pieces.has(`${file}${rank}`);
      if (!swung && rank !== 8) floatedBeforeSwing++;
      if (swung && file >= 5) furiCountByFile.set(file, (furiCountByFile.get(file) ?? 0) + 1);
    }
    prevSquare = square;
    if (ply <= YOKOFU_PLIES && has(v, 3, 4, "R")) yokofu = true;
    if (ply <= 20 && has(v, 2, 5, "P")) rookPawnAdvanced = true;
    if (has(v, 7, 5, "P")) {
      pawn75 = true;
      if (ply <= HAYAISHIDA_PLIES) earlyPawn75 = true;
    }
  }

  let rookFile: number | null = null;
  let rookCount = 0;
  for (const [file, count] of fileCount) {
    if (count > rookCount) {
      rookCount = count;
      rookFile = file;
    }
  }
  // 振り飛車の筋: 振ったあとに居た手数が最も多い筋
  let furiFile: number | null = null;
  let furiCount = 0;
  let furiTotal = 0;
  for (const [file, count] of furiCountByFile) {
    furiTotal += count;
    if (count > furiCount) {
      furiCount = count;
      furiFile = file;
    }
  }
  // 1 手だけ通過したような筋は採用しない。
  // 浮き飛車で戦ってから 8 段目に引いて回した (中盤の転回) なら、振ったあとの方が長いときだけ採る
  if (furiCount < 2 || furiTotal <= floatedBeforeSwing) furiFile = null;

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

type Side = "black" | "white";

/**
 * 戦法のルール。「駒配置 (すべて揃う) + 持ち駒 + 手数上限」で、条件を満たす局面が
 * maxPly 手目までに 1 つでもあれば認定する (将棋ウォーズのエフェクト条件と同じ考え方)。
 * 先手視点で書く: 大文字が自分の駒、小文字が相手の駒。後手は盤を回して同じルールを使う。
 * 配置の多くは @shogi/classifier (MIT, jsr.io/@shogi/classifier v0.1.5 src/rules.ts) を参考にした。
 */
export interface OpeningRule {
  name: string;
  /** [file, rank, piece]。すべて揃うこと */
  pieces: Array<[number, number, string]>;
  /** 持ち駒にあること。"B" は自分、"b" は相手 */
  hand?: string[];
  /** 持ち駒に無いこと */
  noHand?: string[];
  /** 自分の角 (馬を含む) が盤上にあること (角道を止めた形の判定用) */
  ownBishop?: boolean;
  /** その局面に至る手で、自分の駒が from から to へ動いたこと */
  moved?: { piece: string; from: [number, number]; to: [number, number] };
  /** 振り飛車の筋 (SideFeatures.furiFile) の指定 */
  file?: number;
  /** 先手・後手の限定 */
  side?: Side;
  /** その局面までに相手の飛車が振られた (自分から見て 5 筋以下に来た) こと */
  opponentFuri?: boolean;
  /** 盤面以外の特徴の条件 */
  when?: (f: SideFeatures) => boolean;
  maxPly: number;
}

/** 振り飛車側の戦法。上から順に試し、最初に当てはまったものを採る (細かいものを先に置く)。 */
export const FURIBISHA_RULES: OpeningRule[] = [
  // 早石田の角交換は仕掛けの一部なので「角交換」を付けない
  { name: "早石田", pieces: [], when: (f) => f.hayaishida, maxPly: OPENING_PLIES },
  {
    name: "ダイレクト向かい飛車",
    pieces: [
      [7, 7, "S"],
      [8, 8, "R"],
    ],
    hand: ["B"],
    maxPly: OPENING_PLIES,
  },
  {
    name: "阪田流向かい飛車",
    pieces: [
      [7, 7, "G"],
      [8, 8, "R"],
      [8, 7, "P"],
      [8, 5, "p"],
    ],
    hand: ["B"],
    maxPly: 20,
  },
  {
    // 後手が角道を開けたまま 5四歩・5二飛
    name: "ゴキゲン中飛車",
    pieces: [
      [5, 8, "R"],
      [5, 6, "P"],
      [6, 7, "P"],
      [7, 6, "P"],
      [8, 8, "B"],
    ],
    side: "white",
    file: 5,
    maxPly: 10,
  },
  {
    name: "先手中飛車",
    pieces: [
      [5, 8, "R"],
      [5, 6, "P"],
      [6, 7, "P"],
    ],
    side: "black",
    file: 5,
    maxPly: 10,
  },
  {
    name: "石田流本組",
    pieces: [
      [7, 6, "R"],
      [7, 5, "P"],
      [7, 7, "N"],
    ],
    noHand: ["B"],
    file: 7,
    maxPly: OPENING_PLIES,
  },
  // ノーマル = 6六歩で角道を止め、自分の角が盤上にある
  {
    name: "ノーマル四間飛車",
    pieces: [
      [6, 8, "R"],
      [6, 6, "P"],
    ],
    ownBishop: true,
    file: 6,
    when: (f) => !f.bishopExchange,
    maxPly: OPENING_PLIES,
  },
  {
    name: "ノーマル三間飛車",
    pieces: [
      [7, 8, "R"],
      [6, 6, "P"],
    ],
    ownBishop: true,
    file: 7,
    when: (f) => !f.bishopExchange && !f.ishida,
    maxPly: OPENING_PLIES,
  },
];

/** 角換わり (相居飛車で序盤に角交換) の中身。当てはまらなければ「角換わり」。 */
export const KAKUGAWARI_RULES: OpeningRule[] = [
  {
    // 相手の角が 2二 に居るうちに自分から 8八 の角で取る (一手損)
    name: "一手損角換わり",
    pieces: [
      [2, 8, "R"],
      [8, 2, "r"],
    ],
    moved: { piece: "B", from: [8, 8], to: [2, 2] },
    hand: ["B"],
    maxPly: 20,
  },
  { name: "角換わり棒銀", pieces: [[2, 6, "S"]], hand: ["B", "b"], maxPly: 40 },
  {
    name: "角換わり早繰り銀",
    pieces: [
      [4, 6, "S"],
      [3, 6, "P"],
      [4, 7, "P"],
    ],
    hand: ["B", "b"],
    maxPly: 40,
  },
  {
    name: "角換わり腰掛け銀",
    pieces: [
      [5, 6, "S"],
      [4, 6, "P"],
      [5, 7, "P"],
    ],
    hand: ["B", "b"],
    maxPly: 50,
  },
];

/**
 * 対抗形の居飛車側の戦法。上から順に試し、最初に当てはまったものを採る (細かいものを先に置く)。
 * どれにも当てはまらなければ囲い名 (居飛車穴熊・左美濃・ミレニアム) か「居飛車」に落ちる。
 * 将棋ウォーズのエフェクト条件はこの環境から読めなかったので、条件は一般的な指し方からの見立て。
 * 実戦の棋譜で外れていたら、ここの配置と手数を直す。
 * どのルールも、その局面までに相手の飛車が振られたこと (opponentFuri) を条件にする。
 */
const IBISHA_VS_FURI_SHAPES: OpeningRule[] = [
  {
    // 対ゴキゲン中飛車で、早い 3七銀 (相手は 5二飛・5四歩)
    name: "超速",
    pieces: [
      [3, 7, "S"],
      [5, 2, "r"],
      [5, 4, "p"],
    ],
    maxPly: 20,
  },
  {
    // 3七桂 から 4五桂 と早く跳ねる
    name: "ポンポン桂",
    pieces: [],
    moved: { piece: "N", from: [3, 7], to: [4, 5] },
    maxPly: 30,
  },
  // へなちょこ急戦: 玉を囲わずに (居玉・6八玉・6九玉) 3六歩・4六銀と出る
  ...(
    [
      [5, 9],
      [6, 8],
      [6, 9],
    ] as const
  ).map(([file, rank]): OpeningRule => ({
    name: "へなちょこ急戦",
    pieces: [
      [file, rank, "K"],
      [4, 6, "S"],
      [3, 6, "P"],
    ],
    maxPly: 30,
  })),
  // エルモ急戦: エルモ囲い (7九玉・7八金・6八銀) から 4六銀 か 4五歩
  ...(
    [
      [4, 6, "S"],
      [4, 5, "P"],
    ] as const
  ).map((attack): OpeningRule => ({
    name: "エルモ急戦",
    pieces: [
      [7, 9, "K"],
      [7, 8, "G"],
      [attack[0], attack[1], attack[2]],
    ],
    when: (f) => f.castle === "エルモ囲い",
    maxPly: OPENING_PLIES,
  })),
  // 舟囲い急戦 (7八玉・5八金)。仕掛けの形で分け、どれでもなければ「舟囲い急戦」
  {
    // 5七銀左 から 4六銀
    name: "斜め棒銀",
    pieces: [
      [7, 8, "K"],
      [5, 8, "G"],
    ],
    moved: { piece: "S", from: [5, 7], to: [4, 6] },
    when: (f) => f.castle === "舟囲い",
    maxPly: OPENING_PLIES,
  },
  {
    name: "対振り棒銀",
    pieces: [
      [7, 8, "K"],
      [5, 8, "G"],
      [2, 6, "S"],
    ],
    when: (f) => f.castle === "舟囲い",
    maxPly: OPENING_PLIES,
  },
  {
    name: "4五歩早仕掛け",
    pieces: [
      [7, 8, "K"],
      [5, 8, "G"],
      [4, 5, "P"],
    ],
    when: (f) => f.castle === "舟囲い",
    maxPly: OPENING_PLIES,
  },
  {
    // 3六歩・4六歩と急戦の構え (鷺宮定跡などはここに入る)
    name: "舟囲い急戦",
    pieces: [
      [7, 8, "K"],
      [5, 8, "G"],
      [3, 6, "P"],
      [4, 6, "P"],
    ],
    when: (f) => f.castle === "舟囲い",
    maxPly: OPENING_PLIES,
  },
];
export const IBISHA_VS_FURI_RULES: OpeningRule[] = IBISHA_VS_FURI_SHAPES.map((rule) => ({
  ...rule,
  opponentFuri: true,
}));

/** 相手の飛車が初めて自分から見て 5 筋以下に来た手数。来なければ Infinity */
function opponentFuriPly(views: BoardView[]): number {
  for (let ply = 1; ply < views.length; ply++) {
    const v = views[ply];
    const file = v ? fileOf(v, "r") : null;
    if (file !== null && file <= 5) return ply;
  }
  return Infinity;
}

function ruleHolds(rule: OpeningRule, views: BoardView[], ply: number): boolean {
  const v = views[ply];
  if (!v) return false;
  if (!rule.pieces.every(([file, rank, piece]) => has(v, file, rank, piece))) return false;
  if (rule.hand && !rule.hand.every((p) => inHand(v, p))) return false;
  if (rule.noHand?.some((p) => inHand(v, p))) return false;
  if (rule.ownBishop && ![...v.pieces.values()].some((p) => p === "B" || p === "+B")) return false;
  if (rule.moved) {
    const prev = views[ply - 1];
    const { piece, from, to } = rule.moved;
    if (!prev || !has(prev, from[0], from[1], piece)) return false;
    if (has(v, from[0], from[1], piece) || !has(v, to[0], to[1], piece)) return false;
  }
  return true;
}

/** 上から順にルールを試し、最初に当てはまった戦法名を返す */
export function matchOpeningRule(
  rules: OpeningRule[],
  views: BoardView[],
  side: Side,
  f: SideFeatures,
): string | null {
  let furiPly: number | undefined;
  for (const rule of rules) {
    if (rule.side && rule.side !== side) continue;
    if (rule.file !== undefined && rule.file !== f.furiFile) continue;
    if (rule.when && !rule.when(f)) continue;
    const first = rule.opponentFuri ? (furiPly ??= opponentFuriPly(views)) : 1;
    const last = Math.min(views.length - 1, rule.maxPly);
    for (let ply = first; ply <= last; ply++) if (ruleHolds(rule, views, ply)) return rule.name;
  }
  return null;
}

function furibishaName(f: SideFeatures, views: BoardView[], side: Side): string {
  const ruled = matchOpeningRule(FURIBISHA_RULES, views, side, f);
  if (ruled) return ruled;
  const base = f.ishida ? "石田流三間飛車" : (FURI_NAME[f.furiFile ?? 0] ?? "振り飛車");
  return f.bishopExchange ? `角交換${base}` : base;
}

function ibishaName(
  self: SideFeatures,
  opponent: SideFeatures,
  bothIbisha: boolean,
  views: BoardView[],
  side: Side,
): string {
  if (self.rookFile === 4) return "右四間飛車";
  if (!bothIbisha) {
    const ruled = matchOpeningRule(IBISHA_VS_FURI_RULES, views, side, self);
    if (ruled) return ruled;
    if (/穴熊/.test(self.castle)) return "居飛車穴熊";
    if (/左美濃|天守閣/.test(self.castle)) return "左美濃";
    if (/ミレニアム/.test(self.castle)) return "ミレニアム";
    return "居飛車";
  }
  if (self.yokofu || opponent.yokofu) return "横歩取り";
  if (self.bishopExchange)
    return matchOpeningRule(KAKUGAWARI_RULES, views, side, self) ?? "角換わり";
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
    black.style === "furibisha"
      ? furibishaName(black, blackViews, "black")
      : ibishaName(black, white, bothIbisha, blackViews, "black");
  info.whiteOpening =
    white.style === "furibisha"
      ? furibishaName(white, whiteViews, "white")
      : ibishaName(white, black, bothIbisha, whiteViews, "white");
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
