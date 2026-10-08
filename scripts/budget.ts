/**
 * 解析の時間配分。pipeline は外側の timeout で殺されうるので、解析は TIME_BUDGET の内側で必ず終える。
 *
 * - 新しい対局は、残り時間が「その対局の見積もり (局面数 × 1 局面の見積もり)」以上あるときだけ始める。
 *   1 局面の見積もりは、その回で実測した 1 局面の平均 (まだ無ければ DEFAULT_PLY_MS) × SAFETY_FACTOR を
 *   MOVE_TIME_LIMIT で頭打ちにしたもの。MOVE_TIME_LIMIT は実測の 20〜40 倍あり、それで見積もると
 *   残り時間が十分でも長い対局を始められないため。
 * - 見積もりが予算全体を超える長い対局は、その回の最初の 1 局に限って始める (そうしないと永遠に解析されない)。
 * - 開始判定は楽観的でよい。最後の砦は局面単位の締め切りで、次の 1 局面を探索すると予算を超えるなら打ち切り、
 *   その対局は書かずに次回に回す。
 *
 * MOVE_TIME_LIMIT が 0 (無制限) なら見積もれないので、予算を超えるまで始めるだけにする。
 */

/** 実測がまだ無いときの 1 局面の見積もり (ms) */
export const DEFAULT_PLY_MS = 2000;
/** 実測の平均に掛ける安全係数 */
export const SAFETY_FACTOR = 3;

/** 1 局 (開始局面から終局まで length + 1 局面) の最悪の解析時間 (ms)。上限なしなら Infinity */
export function worstGameMs(length: number, moveTimeLimitMs: number): number {
  return moveTimeLimitMs > 0 ? (length + 1) * moveTimeLimitMs : Infinity;
}

export interface BudgetState {
  /** 解析を始めてからの経過時間 (ms) */
  elapsedMs: number;
  /** TIME_BUDGET (ms) */
  budgetMs: number;
  /** MOVE_TIME_LIMIT (ms)。0 以下は上限なし */
  moveTimeLimitMs: number;
  /** この回で実測した 1 局面あたりの平均 (ms)。まだ 1 局面も探索していなければ省略 */
  avgPlyMs?: number;
}

/** 1 局の見積もり (ms)。上限なしなら Infinity */
export function estimateGameMs(s: BudgetState, length: number): number {
  if (s.moveTimeLimitMs <= 0) return Infinity;
  const ply = Math.min((s.avgPlyMs ?? DEFAULT_PLY_MS) * SAFETY_FACTOR, s.moveTimeLimitMs);
  return (length + 1) * ply;
}

/** この対局を始めてよいか。done はこの回で書き終えた局数 */
export function canStartGame(s: BudgetState, length: number, done: number): boolean {
  const remaining = s.budgetMs - s.elapsedMs;
  if (remaining <= 0) return false;
  if (s.moveTimeLimitMs <= 0) return true;
  const estimate = estimateGameMs(s, length);
  if (estimate <= remaining) return true;
  return done === 0 && estimate > s.budgetMs;
}

/** 次の 1 局面を探索してよいか (探索 1 回は最長 MOVE_TIME_LIMIT) */
export function canStartPly(s: BudgetState): boolean {
  if (s.moveTimeLimitMs <= 0) return s.elapsedMs < s.budgetMs;
  return s.elapsedMs + s.moveTimeLimitMs <= s.budgetMs;
}
