import { solveMateProblem } from "../core/mateProblems";
import { attackStep, judgeTsumero, nonDefendingReply } from "../core/tsume";

/** Web Worker で回す詰み探索。画面のスレッドを止めないように、ここに並べた関数だけを Worker に投げる */
export const TSUME_OPS = { attackStep, judgeTsumero, nonDefendingReply, solveMateProblem };

export type TsumeOps = typeof TSUME_OPS;
export type TsumeOp = keyof TsumeOps;

export interface TsumeRequest {
  id: number;
  op: TsumeOp;
  args: unknown[];
}

export interface TsumeResponse {
  id: number;
  result: unknown;
}

export function runOp(op: TsumeOp, args: unknown[]): unknown {
  return (TSUME_OPS[op] as (...a: unknown[]) => unknown)(...args);
}
