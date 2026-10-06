import type { ReportRecord } from "../core/report";

/** 対局者ごとに、最後に開いた対策レポートの hash */
const SEEN_KEY = "shogi-atlas:reports-seen";

function readSeen(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as unknown;
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** まだ開いていない (または開いた後に更新された) レポートか */
export function isReportUnseen(report: Pick<ReportRecord, "name" | "hash">): boolean {
  return readSeen()[report.name] !== report.hash;
}

/** レポートを開いたときに呼ぶ */
export function markReportSeen(report: Pick<ReportRecord, "name" | "hash">): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ ...readSeen(), [report.name]: report.hash }));
  } catch {
    // 保存できなくても画面は動く
  }
}
