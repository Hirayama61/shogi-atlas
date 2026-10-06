import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Engine } from "./engine";

// 実際の wasm エンジンを起動する。読み込みに数秒かかるので 1 回だけ作る
let engine: Engine;
beforeAll(async () => {
  engine = await Engine.create({ threads: 1, hashMb: 16 });
}, 60_000);
afterAll(() => {
  engine?.quit();
});

describe("Engine.analyze", () => {
  it("深さ指定で読み切ると stopped は false で、指定した深さに達する", async () => {
    const r = await engine.analyze("position startpos", 4);
    expect(r.stopped).toBe(false);
    expect(r.depth).toBeGreaterThanOrEqual(4);
    expect(r.bestmove).toMatch(/^[1-9][a-i][1-9][a-i]\+?$|^[PLNSGBR]\*[1-9][a-i]$/);
  }, 30_000);

  it("時間上限を超えたら stop で打ち切り、それまでの最善手と到達した深さを返す", async () => {
    const started = Date.now();
    const r = await engine.analyze("position startpos", 40, 300);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(r.stopped).toBe(true);
    expect(r.depth).toBeGreaterThan(0);
    expect(r.depth).toBeLessThan(40);
    expect(r.bestmove).not.toBe("resign");
  }, 30_000);
});
