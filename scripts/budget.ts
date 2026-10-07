/**
 * 解析の時間配分。pipeline は外側の timeout で殺されうるので、解析は TIME_BUDGET の内側で必ず終える。
 *
 * - 新しい対局は、残り時間が「その対局の最悪見積もり (局面数 × MOVE_TIME_LIMIT)」以上あるときだけ始める。
 * - 見積もりは悲観的なので、予算全体でも収まらない長い対局はその回の最初の 1 局に限って始める
 *   (そうしないと永遠に解析されない)。その場合も下の締め切りで打ち切られる。
 * - 対局の途中でも、次の 1 局面を探索すると予算を超えるなら打ち切り、その対局は書かずに次回に回す。
 *
 * MOVE_TIME_LIMIT が 0 (無制限) なら見積もれないので、予算を超えるまで始めるだけにする。
 */

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
}

/** この対局を始めてよいか。done はこの回で書き終えた局数 */
export function canStartGame(s: BudgetState, length: number, done: number): boolean {
  const remaining = s.budgetMs - s.elapsedMs;
  if (remaining <= 0) return false;
  if (s.moveTimeLimitMs <= 0) return true;
  const worst = worstGameMs(length, s.moveTimeLimitMs);
  if (worst <= remaining) return true;
  return done === 0 && worst > s.budgetMs;
}

/** 次の 1 局面を探索してよいか (探索 1 回は最長 MOVE_TIME_LIMIT) */
export function canStartPly(s: BudgetState): boolean {
  if (s.moveTimeLimitMs <= 0) return s.elapsedMs < s.budgetMs;
  return s.elapsedMs + s.moveTimeLimitMs <= s.budgetMs;
}
