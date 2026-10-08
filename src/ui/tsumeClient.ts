import {
  runOp,
  type TsumeOp,
  type TsumeOps,
  type TsumeRequest,
  type TsumeResponse,
} from "./tsumeOps";

/**
 * 詰み探索を Web Worker で回す。Worker が使えない環境 (テストの jsdom) や Worker が落ちたときは、
 * 画面のスレッドで (描画を待ってから) 回す。
 */
let worker: Worker | null | undefined;
let seq = 0;
const pending = new Map<number, { req: TsumeRequest; resolve: (v: unknown) => void }>();

function inline(req: TsumeRequest): Promise<unknown> {
  return new Promise((resolve) => setTimeout(() => resolve(runOp(req.op, req.args)), 0));
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === "undefined") return (worker = null);
  try {
    const w = new Worker(new URL("./tsumeWorker.ts", import.meta.url), { type: "module" });
    w.addEventListener("message", (e: MessageEvent<TsumeResponse>) => {
      const p = pending.get(e.data.id);
      pending.delete(e.data.id);
      p?.resolve(e.data.result);
    });
    w.addEventListener("error", () => {
      // 以後は画面のスレッドで回し、待っている問い合わせもやり直す
      worker = null;
      w.terminate();
      for (const [id, p] of pending) {
        pending.delete(id);
        void inline(p.req).then(p.resolve);
      }
    });
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

export function runTsume<K extends TsumeOp>(
  op: K,
  ...args: Parameters<TsumeOps[K]>
): Promise<ReturnType<TsumeOps[K]>> {
  const req: TsumeRequest = { id: ++seq, op, args };
  const w = getWorker();
  if (!w) return inline(req) as Promise<ReturnType<TsumeOps[K]>>;
  return new Promise((resolve) => {
    pending.set(req.id, { req, resolve: resolve as (v: unknown) => void });
    w.postMessage(req);
  });
}
