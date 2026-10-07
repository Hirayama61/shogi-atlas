import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { removeSelfIdDirs } from "./players";

let dir: string;

async function put(rel: string, body: string): Promise<void> {
  await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await writeFile(path.join(dir, rel), body);
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "players-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("removeSelfIdDirs", () => {
  it("自分の ID のディレクトリを消し、report.md を自分側に引き継ぐ", async () => {
    await put("旧ID/profile.md", "old");
    await put("旧ID/report.md", "前回のレポート");
    await put("自分/profile.md", "new");
    await put("相手/profile.md", "keep");

    expect(await removeSelfIdDirs(dir, ["旧ID", "無いID"])).toEqual(["旧ID"]);
    expect(existsSync(path.join(dir, "旧ID"))).toBe(false);
    expect(await readFile(path.join(dir, "自分/report.md"), "utf8")).toBe("前回のレポート");
    expect(existsSync(path.join(dir, "相手/profile.md"))).toBe(true);
  });

  it("自分側に report.md があれば上書きせずに旧ディレクトリごと消す", async () => {
    await put("旧ID/report.md", "古い");
    await put("自分/report.md", "新しい");

    await removeSelfIdDirs(dir, new Set(["旧ID"]));
    expect(existsSync(path.join(dir, "旧ID"))).toBe(false);
    expect(await readFile(path.join(dir, "自分/report.md"), "utf8")).toBe("新しい");
  });

  it("自分のディレクトリ自体は消さない", async () => {
    await put("自分/profile.md", "x");
    expect(await removeSelfIdDirs(dir, ["自分"])).toEqual([]);
    expect(existsSync(path.join(dir, "自分/profile.md"))).toBe(true);
  });
});
