import { Position } from "tsshogi";
import { isAnalysisStale, type AnalysisRecord } from "./analysis";
import { usiMoves } from "./branches";
import { isCheckmated } from "./mate";
import type { Side } from "./stats";
import {
  MAX_MATE_PLY,
  judgeTsumero,
  nonDefendingReply,
  playMove,
  type SearchLimits,
} from "./tsume";
import type { GameRecord } from "./types";

/**
 * 終盤力強化の「詰めろと詰み」の問題。エンジンが短手数の詰みを示した局面の 2 手前 (詰ます側の手番) を出題し、
 * 詰めろをかける手 → 相手の詰みを防がない手 → 詰将棋の順に解く。
 * 抽出は解析の評価だけで行い (探索しない)、詰めろの確認と手順は問題を開くときに tsume.ts で読む。
 */

export interface MateProblem {
  /** `mate:<対局 ID>:<手数>` (囲い崩しの問題と同じ記録に入るので接頭辞で分ける) */
  id: string;
  gameId: string;
  /** 詰めろをかける手の手数。問題の局面はその 1 手前 */
  ply: number;
  /** 問題の局面 (手数つき SFEN) */
  sfen: string;
  /** 手番 (詰ます側) */
  side: Side;
  mover: string;
  opponent: string;
  /** 詰まされる側 (相手) の囲い */
  castle: string;
  /** 相手の応手の後の詰みの手数 (エンジンの評価) */
  mateLength: number;
  /** 実戦で指した詰めろの手 (USI) と、それへの相手の応手 */
  played: string;
  reply: string;
  /** 問題の局面でのエンジンの最善手 */
  best?: string;
  /** 実戦で詰みを逃した */
  missed: boolean;
  startedAt?: string;
}

/** 詰めろの手が王手か (王手で迫った局面は詰将棋そのものなので、詰めろの問題にしない) */
function isCheck(sfen: string, usi: string): boolean {
  const after = playMove(sfen, usi);
  if (!after) return true;
  return Position.newBySFEN(after)?.checked ?? true;
}

function checkmated(key: string | undefined): boolean {
  if (key === undefined) return false;
  const pos = Position.newBySFEN(`${key} 1`);
  return !!pos && isCheckmated(pos);
}

/**
 * 1 局から詰めろの問題を抜き出す。解析が無いか古ければ空。
 * 手番側が maxPly 手以内に詰ませられる局面 (k 手目の後) を探し、その 2 手前の局面を問題にする。
 * 2 手前ですでに詰みがあった (詰めろでなく詰将棋) か、実戦の手が王手だったものは除く。
 * 詰みの局面で実戦の次の手が詰みを続けなかった (または指さずに終わった) ものを「逃した」とする。
 */
export function extractMateProblems(
  game: GameRecord,
  analysis: AnalysisRecord | undefined,
  maxPly = MAX_MATE_PLY,
): MateProblem[] {
  if (!analysis || isAnalysisStale(game, analysis)) return [];
  const evals = new Map(analysis.plies.map((p) => [p.ply, p] as const));
  const moves = usiMoves(game.usi);
  const out: MateProblem[] = [];
  for (let k = 2; k < game.positions.length; k++) {
    const mate = evals.get(k)?.mate;
    if (mate === undefined || mate < 1 || mate > maxPly) continue;
    const before = evals.get(k - 2);
    if (before?.mate !== undefined && before.mate > 0) continue;
    const key = game.positions[k - 2];
    const played = moves[k - 2];
    const reply = moves[k - 1];
    if (key === undefined || !played || !reply) continue;
    const sfen = `${key} ${k - 1}`;
    if (isCheck(sfen, played)) continue;
    const side: Side = key.split(" ")[1] === "w" ? "white" : "black";
    const opponentSide: Side = side === "black" ? "white" : "black";
    // 詰みの局面の次の手で詰みが続いた (相手から見て詰まされる評価) か、詰ませていれば逃していない
    const next = evals.get(k + 1);
    const kept = checkmated(game.positions[k + 1]) || (next?.mate !== undefined && next.mate < 0);
    const castle =
      (opponentSide === "black" ? game.opening.blackCastle : game.opening.whiteCastle) || "不明";
    const problem: MateProblem = {
      id: `mate:${game.id}:${k - 1}`,
      gameId: game.id,
      ply: k - 1,
      sfen,
      side,
      mover: side === "black" ? game.black : game.white,
      opponent: side === "black" ? game.white : game.black,
      castle,
      mateLength: mate,
      played,
      reply,
      missed: !kept,
    };
    const best = before?.best;
    if (best) problem.best = best;
    if (game.startedAt) problem.startedAt = game.startedAt;
    out.push(problem);
  }
  return out;
}

/** 全棋譜の詰めろの問題。並びは、自分が逃した問題 → 詰みの短い順 → 新しい対局の順 */
export function buildMateProblems(
  games: GameRecord[],
  analyses: Map<string, AnalysisRecord>,
  maxPly = MAX_MATE_PLY,
): MateProblem[] {
  const all = games.flatMap((g) => extractMateProblems(g, analyses.get(g.id), maxPly));
  return all.sort(
    (a, b) =>
      Number(b.missed) - Number(a.missed) ||
      a.mateLength - b.mateLength ||
      (b.startedAt ?? "").localeCompare(a.startedAt ?? "") ||
      a.id.localeCompare(b.id),
  );
}

/** 絞り込みの選択肢: 詰みの手数ごと・囲いごとの問題数 */
export function mateFilterCounts(problems: MateProblem[]): {
  lengths: Array<{ length: number; problems: number }>;
  castles: Array<{ castle: string; problems: number }>;
} {
  const lengths = new Map<number, number>();
  const castles = new Map<string, number>();
  for (const p of problems) {
    lengths.set(p.mateLength, (lengths.get(p.mateLength) ?? 0) + 1);
    castles.set(p.castle, (castles.get(p.castle) ?? 0) + 1);
  }
  return {
    lengths: [...lengths]
      .map(([length, problems]) => ({ length, problems }))
      .sort((a, b) => a.length - b.length),
    castles: [...castles]
      .map(([castle, problems]) => ({ castle, problems }))
      .sort((a, b) => b.problems - a.problems || a.castle.localeCompare(b.castle)),
  };
}

export interface MateSolution {
  /** 詰めろの手 */
  tsumero: string;
  /** 詰みを防がない相手の応手 */
  reply: string;
  /** 応手の後の詰み手順 */
  mate: string[];
}

/**
 * 問題の正解の手順を読む。実戦の手、エンジンの最善手の順に詰めろかを確かめ、
 * 詰めろなら相手の詰みを防がない応手 (実戦の手で詰むならその手) と詰み手順を返す。読み切れなければ null。
 */
export function solveMateProblem(
  problem: Pick<MateProblem, "sfen" | "played" | "reply" | "best">,
  limits: SearchLimits = {},
): MateSolution | null {
  const candidates = [problem.played, problem.best].filter((u): u is string => !!u);
  for (const usi of new Set(candidates)) {
    const t = judgeTsumero(problem.sfen, usi, MAX_MATE_PLY, limits);
    if (!t.tsumero) continue;
    const after = playMove(problem.sfen, usi);
    if (!after) continue;
    const r = nonDefendingReply(
      after,
      usi === problem.played ? problem.reply : undefined,
      MAX_MATE_PLY,
      limits,
    );
    if (r) return { tsumero: usi, reply: r.reply, mate: r.mate };
  }
  return null;
}
