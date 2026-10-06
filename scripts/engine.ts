/**
 * やねうら王 (WebAssembly 版) を Node から USI で操作する薄いラッパー。
 * 評価関数は NNUE K-P (パッケージに内蔵)。
 */
import os from "node:os";
import { createRequire } from "node:module";
import type { YaneuraOuModule } from "@mizarjp/yaneuraou.k-p/lib/yaneuraou.module";

const require = createRequire(import.meta.url);

export interface EngineOptions {
  threads?: number;
  hashMb?: number;
}

export interface SearchResult {
  /** 手番側から見た評価値 (cp)。詰みのときは mate を参照 */
  cp: number | null;
  /** 詰みまでの手数 (手番側が詰ます側なら正) */
  mate: number | null;
  bestmove: string;
  pv: string[];
  depth: number;
  /** 時間上限で探索を打ち切った (depth は到達した深さ) */
  stopped: boolean;
}

export class Engine {
  private module!: YaneuraOuModule;
  private waiters: Array<{ prefix: string; resolve: (line: string) => void }> = [];
  private lines: string[] = [];
  readonly name = "YaneuraOu NNUE K-P (wasm)";

  static async create(opts: EngineOptions = {}): Promise<Engine> {
    const e = new Engine();
    const factory = require("@mizarjp/yaneuraou.k-p") as () => Promise<YaneuraOuModule>;
    e.module = await factory();
    e.module.addMessageListener((line: string) => e.onLine(line));
    await e.send("usi", "usiok");
    e.post(
      `setoption name Threads value ${opts.threads ?? Math.max(1, Math.min(4, os.cpus().length))}`,
    );
    e.post(`setoption name USI_Hash value ${opts.hashMb ?? 128}`);
    e.post("setoption name PvInterval value 0");
    e.post("setoption name USI_OwnBook value false");
    await e.send("isready", "readyok");
    return e;
  }

  private onLine(line: string): void {
    this.lines.push(line);
    const i = this.waiters.findIndex((w) => line.startsWith(w.prefix));
    if (i >= 0) {
      const [w] = this.waiters.splice(i, 1);
      w!.resolve(line);
    }
  }

  private post(cmd: string): void {
    this.module.postMessage(cmd);
  }

  private send(cmd: string, waitPrefix: string): Promise<string> {
    return new Promise((resolve) => {
      this.waiters.push({ prefix: waitPrefix, resolve });
      this.post(cmd);
    });
  }

  /**
   * 局面を深さ指定で探索する。usi は "position ..." の形。
   * timeLimitMs を超えても bestmove が返らなければ stop を送り、それまでの最善手と評価値で打ち切る
   * (探索が広がる局面で 1 局面に数十分かかるのを防ぐ)。0 以下なら上限なし。
   */
  async analyze(positionUsi: string, depth: number, timeLimitMs = 0): Promise<SearchResult> {
    this.lines = [];
    this.post(positionUsi);
    let stopped = false;
    let finished = false;
    const timer =
      timeLimitMs > 0
        ? setTimeout(() => {
            if (finished) return;
            stopped = true;
            this.post("stop");
          }, timeLimitMs)
        : undefined;
    const best = await this.send(`go depth ${depth}`, "bestmove");
    finished = true;
    if (timer) clearTimeout(timer);
    const bestmove = best.split(/\s+/)[1] ?? "resign";
    const info = this.lines
      .filter((l) => l.startsWith("info") && / score /.test(l) && !/ (lower|upper)bound/.test(l))
      .pop();
    const result: SearchResult = { cp: null, mate: null, bestmove, pv: [], depth: 0, stopped };
    if (info) {
      const m = /depth (\d+).*? score (cp|mate) (-?\d+)(?: .*? pv (.+))?$/.exec(info);
      if (m) {
        result.depth = Number(m[1]);
        if (m[2] === "cp") result.cp = Number(m[3]);
        else result.mate = Number(m[3]);
        result.pv = m[4] ? m[4].trim().split(/\s+/) : [];
      }
    }
    return result;
  }

  quit(): void {
    this.module.postMessage("quit");
    this.module.terminate();
  }
}
