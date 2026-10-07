/**
 * players/ 配下の片付け。自分の ID ごとのディレクトリは players/自分/ にまとめたので残さない。
 */
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { SELF_NAME } from "../src/core/self";

/**
 * players/<自分の ID>/ を消す。profile は players/自分/ に作り直してあるので捨てるが、
 * report.md は手書きの成果物なので、players/自分/report.md が無ければ前回レポートとして移す。
 * 失敗しても pipeline を止めないよう、警告して続行する。片付けたディレクトリ名を返す。
 */
export async function removeSelfIdDirs(
  playersDir: string,
  selfIds: Iterable<string>,
): Promise<string[]> {
  const removed: string[] = [];
  const selfDir = path.join(playersDir, SELF_NAME);
  for (const id of selfIds) {
    if (id === SELF_NAME) continue;
    const dir = path.join(playersDir, id);
    if (!existsSync(dir)) continue;
    try {
      const report = path.join(dir, "report.md");
      const selfReport = path.join(selfDir, "report.md");
      if (existsSync(report) && !existsSync(selfReport)) {
        await mkdir(selfDir, { recursive: true });
        await rename(report, selfReport);
        console.log(`players/${id}/report.md を players/${SELF_NAME}/report.md に移しました`);
      }
      await rm(dir, { recursive: true, force: true });
      console.log(`players/${id}/ は自分の ID のディレクトリなので消しました`);
      removed.push(id);
    } catch (e) {
      console.warn(`players/${id}/ を片付けられませんでした: ${String(e)}`);
    }
  }
  return removed;
}
