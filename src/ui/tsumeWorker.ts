import { runOp, type TsumeRequest, type TsumeResponse } from "./tsumeOps";

self.addEventListener("message", (e: MessageEvent<TsumeRequest>) => {
  const { id, op, args } = e.data;
  const response: TsumeResponse = { id, result: runOp(op, args) };
  self.postMessage(response);
});
