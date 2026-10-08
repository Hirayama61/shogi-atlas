import type { ProblemRecord } from "../core/endgame";

/** 終盤力強化の問題ごとの記録 (問題 ID → 回数と最後の正誤)。端末内にだけ残す */
const RECORDS_KEY = "shogi-atlas:endgame-records";

export function readProblemRecords(): Record<string, ProblemRecord> {
  try {
    const v = JSON.parse(localStorage.getItem(RECORDS_KEY) ?? "{}") as unknown;
    if (!v || typeof v !== "object") return {};
    const out: Record<string, ProblemRecord> = {};
    for (const [id, r] of Object.entries(v as Record<string, unknown>)) {
      const x = r as Partial<ProblemRecord> | null;
      if (x && typeof x.attempts === "number" && typeof x.correct === "boolean")
        out[id] = { attempts: x.attempts, correct: x.correct };
    }
    return out;
  } catch {
    return {};
  }
}

/** 答えたときに呼ぶ。更新後の記録を返す */
export function recordAnswer(id: string, correct: boolean): Record<string, ProblemRecord> {
  const records = readProblemRecords();
  records[id] = { attempts: (records[id]?.attempts ?? 0) + 1, correct };
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch {
    // 保存できなくても、この画面のあいだは記録を使う
  }
  return records;
}
