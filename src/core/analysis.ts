import type { GameRecord } from "./types";

/**
 * エンジン解析の結果。shogi-atlas-data の analysis/<id>.json に保存する。
 * 評価値はすべて先手から見た値 (centipawn)。詰みは MATE_CP を上限に変換する。
 */
export interface PlyEval {
  ply: number;
  /** 先手から見た評価値 (cp)。詰みは ±MATE_CP に丸める */
  cp: number;
  /** 詰みまでの手数 (手番側が詰ます側なら正)。詰みでなければ省略 */
  mate?: number;
  /** その局面での最善手 (USI)。終局局面では省略 */
  best?: string;
  /** 読み筋 (USI)。先頭が best */
  pv?: string[];
}

export interface AnalysisRecord {
  schema: 1;
  id: string;
  engine: { name: string; depth: number };
  analyzedAt: string;
  /** 解析したときの対局の状態。reindex で手順が変わったら解析をやり直すために持つ */
  game?: { importedAt: string; length: number };
  plies: PlyEval[];
}

/**
 * 対局が解析後に更新されていれば true。
 * importedAt が変わった (reindex された) か、局面数が手数と合わなければやり直す。
 */
export function isAnalysisStale(
  game: { importedAt: string; length: number },
  analysis: AnalysisRecord,
): boolean {
  if (analysis.plies.length !== game.length + 1) return true;
  if (analysis.game && analysis.game.importedAt !== game.importedAt) return true;
  return false;
}

export const MATE_CP = 3000;

/** analysis/index.json の形 */
export interface AnalysisIndex {
  schema: 1;
  /** id → analyzedAt */
  analyses: Record<string, string>;
}

/** データリポジトリや DB から読んだ解析結果の最低限の検査 */
export function normalizeAnalysis(raw: unknown): AnalysisRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<AnalysisRecord>;
  if (typeof r.id !== "string" || !Array.isArray(r.plies)) return null;
  const plies = r.plies.filter(
    (p): p is PlyEval =>
      !!p && typeof p === "object" && typeof p.ply === "number" && typeof p.cp === "number",
  );
  const out: AnalysisRecord = {
    schema: 1,
    id: r.id,
    engine: r.engine && typeof r.engine === "object" ? r.engine : { name: "unknown", depth: 0 },
    analyzedAt: typeof r.analyzedAt === "string" ? r.analyzedAt : "",
    plies,
  };
  if (r.game && typeof r.game === "object") out.game = r.game;
  return out;
}

/** 評価値を先手の勝率 (0..1) に変換する。将棋の評価値では 600 cp で約 73%。 */
export function winProbability(cp: number): number {
  return 1 / (1 + Math.exp(-cp / 600));
}

export type Judgement = "good" | "inaccuracy" | "mistake" | "blunder";

export const JUDGEMENT_LABEL: Record<Judgement, string> = {
  good: "",
  inaccuracy: "疑問手",
  mistake: "悪手",
  blunder: "大悪手",
};

export type Phase = "opening" | "middlegame" | "endgame";

export const PHASE_LABEL: Record<Phase, string> = {
  opening: "序盤",
  middlegame: "中盤",
  endgame: "終盤",
};

/** 手数で大まかに局面の段階を分ける。 */
export function phaseOf(ply: number, length: number): Phase {
  if (ply <= 30) return "opening";
  if (ply > 70) return "endgame";
  // 短い対局では最後の 20 手を終盤とみなす (ただし 40 手目以降)
  if (ply > 40 && ply > length - 20) return "endgame";
  return "middlegame";
}

export interface MoveReview {
  ply: number;
  side: "black" | "white";
  phase: Phase;
  /** 指した手 (USI) */
  played: string;
  /** エンジンの最善手 (USI)。指した手と同じならそれが最善 */
  best?: string;
  /** 指す前の評価値 (先手視点) */
  cpBefore: number;
  /** 指した後の評価値 (先手視点) */
  cpAfter: number;
  /** 指した側から見た損失 (cp, 0 以上) */
  loss: number;
  /** 指した側から見た勝率の減少 (0..1) */
  swing: number;
  judgement: Judgement;
}

/** 勝率の減少幅から評価する。cp の損失だけだと大差の局面で過剰に反応するため。 */
export function judge(swing: number, loss: number): Judgement {
  if (swing >= 0.25 || loss >= 800) return "blunder";
  if (swing >= 0.12 || loss >= 350) return "mistake";
  if (swing >= 0.05 || loss >= 120) return "inaccuracy";
  return "good";
}

/**
 * 対局と解析結果から各手の評価を出す。plies[k] は k 手目を指した後の局面。
 */
export function reviewMoves(game: GameRecord, analysis: AnalysisRecord): MoveReview[] {
  const byPly = new Map(analysis.plies.map((p) => [p.ply, p] as const));
  const moves = game.usi
    .replace(/^position startpos( moves)?\s*/, "")
    .split(/\s+/)
    .filter(Boolean);
  const out: MoveReview[] = [];
  for (let ply = 1; ply <= moves.length; ply++) {
    const before = byPly.get(ply - 1);
    const after = byPly.get(ply);
    if (!before || !after) continue;
    const side = ply % 2 === 1 ? "black" : "white";
    const sign = side === "black" ? 1 : -1;
    const loss = Math.max(0, sign * (before.cp - after.cp));
    const swing = Math.max(0, sign * (winProbability(before.cp) - winProbability(after.cp)));
    const played = moves[ply - 1]!;
    const review: MoveReview = {
      ply,
      side,
      phase: phaseOf(ply, moves.length),
      played,
      cpBefore: before.cp,
      cpAfter: after.cp,
      loss,
      swing,
      judgement: judge(swing, loss),
    };
    if (before.best && before.best !== played) review.best = before.best;
    out.push(review);
  }
  return out;
}

export interface SideReview {
  moves: number;
  /** 1 手あたりの平均損失 (cp) */
  averageLoss: number;
  counts: Record<Judgement, number>;
  byPhase: Record<Phase, { moves: number; averageLoss: number; blunders: number }>;
}

export interface GameReview {
  id: string;
  black: SideReview;
  white: SideReview;
  moves: MoveReview[];
  /** 先手視点の評価値の推移 (ply 順) */
  curve: Array<{ ply: number; cp: number }>;
}

function emptySide(): SideReview {
  const phase = () => ({ moves: 0, averageLoss: 0, blunders: 0 });
  return {
    moves: 0,
    averageLoss: 0,
    counts: { good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
    byPhase: { opening: phase(), middlegame: phase(), endgame: phase() },
  };
}

export function reviewGame(game: GameRecord, analysis: AnalysisRecord): GameReview {
  const moves = reviewMoves(game, analysis);
  const sides = { black: emptySide(), white: emptySide() };
  const totals = { black: 0, white: 0 };
  const phaseTotals: Record<"black" | "white", Record<Phase, number>> = {
    black: { opening: 0, middlegame: 0, endgame: 0 },
    white: { opening: 0, middlegame: 0, endgame: 0 },
  };
  for (const m of moves) {
    const s = sides[m.side];
    s.moves++;
    totals[m.side] += m.loss;
    s.counts[m.judgement]++;
    const p = s.byPhase[m.phase];
    p.moves++;
    phaseTotals[m.side][m.phase] += m.loss;
    if (m.judgement === "blunder") p.blunders++;
  }
  for (const side of ["black", "white"] as const) {
    const s = sides[side];
    s.averageLoss = s.moves ? Math.round(totals[side] / s.moves) : 0;
    for (const phase of ["opening", "middlegame", "endgame"] as const) {
      const p = s.byPhase[phase];
      p.averageLoss = p.moves ? Math.round(phaseTotals[side][phase] / p.moves) : 0;
    }
  }
  return {
    id: game.id,
    black: sides.black,
    white: sides.white,
    moves,
    curve: analysis.plies.map((p) => ({ ply: p.ply, cp: p.cp })),
  };
}
