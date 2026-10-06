// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PARSER_VERSION } from "../core/normalize";
import { parseKifu } from "../core/parse";
import { toSummary } from "../core/types";
import { fixtureReport, USI_SHIKEN_VS_FUNA, WARS_KIF } from "../core/__tests__/fixtures";
import { db } from "../db/db";
import { DEFAULT_CONFIG, needsFetch, pullFromDataRepo, loadConfig, saveConfig } from "./github";

const source = { kind: "paste" as const };
const config = { ...DEFAULT_CONFIG, token: "t" };

function mockRepo(files: Record<string, unknown>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const m = /contents\/(.+?)\?ref=/.exec(url);
      const path = m?.[1] ?? "";
      calls.push(path);
      if (!(path in files)) return new Response("not found", { status: 404 });
      const body = files[path];
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}

describe("pullFromDataRepo", () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.reports.clear();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("無いものだけ取り、2 回目は取り直さない", async () => {
    const a = await parseKifu(WARS_KIF, { source, importedAt: "2026-01-01T00:00:00Z" });
    const b = await parseKifu(USI_SHIKEN_VS_FUNA, { source, importedAt: "2026-01-01T00:00:00Z" });
    const files = {
      "index.json": { schema: 1, updatedAt: "x", games: [toSummary(a), toSummary(b)] },
      [`games/${a.id}.json`]: a,
      [`games/${b.id}.json`]: b,
    };
    const calls = mockRepo(files);
    expect(await pullFromDataRepo(config)).toEqual({ added: 2, updated: 0, total: 2, analyses: 0 });
    expect(calls).toContain(`games/${a.id}.json`);

    calls.length = 0;
    expect(await pullFromDataRepo(config)).toEqual({ added: 0, updated: 0, total: 2, analyses: 0 });
    expect(calls).toEqual(["index.json", "analysis/index.json"]);
  });

  it("解析の版が変わったものは取り直す", async () => {
    const a = await parseKifu(WARS_KIF, { source, importedAt: "2026-01-01T00:00:00Z" });
    await db.games.put({ ...a, parser: PARSER_VERSION - 1 });
    const calls = mockRepo({
      "index.json": { schema: 1, updatedAt: "x", games: [toSummary(a)] },
      [`games/${a.id}.json`]: a,
    });
    expect(await pullFromDataRepo(config)).toEqual({ added: 0, updated: 1, total: 1, analyses: 0 });
    expect(calls).toContain(`games/${a.id}.json`);
    expect((await db.games.get(a.id))?.parser).toBe(PARSER_VERSION);
  });

  it("index.json が無ければ何もしない、壊れたレコードは無視する", async () => {
    mockRepo({});
    expect(await pullFromDataRepo(config)).toEqual({ added: 0, updated: 0, total: 0, analyses: 0 });
    vi.unstubAllGlobals();
    mockRepo({
      "index.json": { schema: 1, updatedAt: "x", games: [{ id: "bad" }, null] },
      "games/bad.json": { id: "bad" },
    });
    expect(await pullFromDataRepo(config)).toEqual({ added: 0, updated: 0, total: 1, analyses: 0 });
  });

  it("認証エラーは例外になる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 401 })),
    );
    await expect(pullFromDataRepo(config)).rejects.toThrow(/トークンが無効/);
  });

  it("needsFetch", async () => {
    const a = toSummary(await parseKifu(WARS_KIF, { source, importedAt: "2026-01-01T00:00:00Z" }));
    expect(needsFetch(undefined, a)).toBe(true);
    expect(needsFetch(a, a)).toBe(false);
    expect(needsFetch({ ...a, importedAt: "2025-01-01T00:00:00Z" }, a)).toBe(true);
    expect(needsFetch({ ...a, parser: 0 }, a)).toBe(true);
  });

  it("設定の保存: remember を外すとトークンは localStorage に残らない", () => {
    saveConfig({ ...config, remember: false });
    expect(localStorage.getItem("shogi-atlas.dataRepo")).not.toContain('"token"');
    expect(loadConfig().token).toBe("t");
    saveConfig({ ...config, remember: true });
    expect(localStorage.getItem("shogi-atlas.dataRepo")).toContain('"token":"t"');
  });

  it("解析結果も取り込み、analyzedAt が同じなら取り直さない", async () => {
    const a = await parseKifu(WARS_KIF, { source, importedAt: "2026-01-01T00:00:00Z" });
    const analysis = {
      schema: 1,
      id: a.id,
      engine: { name: "fake", depth: 1 },
      analyzedAt: "2026-02-01T00:00:00Z",
      plies: [{ ply: 0, cp: 0 }],
    };
    const calls = mockRepo({
      "index.json": { schema: 1, updatedAt: "x", games: [toSummary(a)] },
      [`games/${a.id}.json`]: a,
      "analysis/index.json": { schema: 1, analyses: { [a.id]: analysis.analyzedAt } },
      [`analysis/${a.id}.json`]: analysis,
    });
    expect(await pullFromDataRepo(config)).toEqual({ added: 1, updated: 0, total: 1, analyses: 1 });
    expect((await db.analyses.get(a.id))?.plies).toHaveLength(1);
    calls.length = 0;
    expect(await pullFromDataRepo(config)).toEqual({ added: 0, updated: 0, total: 1, analyses: 0 });
    expect(calls).toEqual(["index.json", "analysis/index.json"]);
  });

  it("対局者ごとの対策レポートを、ある人だけ、変わったときだけ取り込み、消えたら消す", async () => {
    const parsed = await parseKifu(WARS_KIF, { source, importedAt: "2026-01-01T00:00:00Z" });
    const a = { ...parsed, black: "taro", white: "jiro", tags: ["taro", "jiro", "将棋ウォーズ"] };
    const report = fixtureReport("taro", a.id);
    const dir = (name: string) => ({ name, type: "dir", sha: "d" });
    const reportEntry = (sha: string) => [
      { name: "profile.md", type: "file", sha: "p" },
      { name: "report.md", type: "file", sha },
    ];
    const files: Record<string, unknown> = {
      "index.json": { schema: 1, updatedAt: "x", games: [toSummary(a)] },
      [`games/${a.id}.json`]: a,
      players: [dir("taro"), dir("jiro"), dir("other"), { name: "README.md", type: "file" }],
      "players/taro": reportEntry("s1"),
      "players/jiro": [{ name: "profile.md", type: "file", sha: "p" }],
      "players/taro/report.md": report,
    };
    const calls = mockRepo(files);
    await pullFromDataRepo(config);
    // レポートの無い人 (jiro)、登録していない人 (other) の report.md は取りに行かない
    expect(calls.filter((c) => c.startsWith("players"))).toEqual([
      "players",
      "players/taro",
      "players/taro/report.md",
      "players/jiro",
    ]);
    expect(await db.reports.get("taro")).toMatchObject({ markdown: report, hash: "s1" });
    expect(await db.reports.get("jiro")).toBeUndefined();

    calls.length = 0;
    await pullFromDataRepo(config);
    expect(calls).not.toContain("players/taro/report.md");

    files["players/taro"] = reportEntry("s2");
    files["players/taro/report.md"] = report + "\n追記";
    await pullFromDataRepo(config);
    expect(await db.reports.get("taro")).toMatchObject({ markdown: report + "\n追記", hash: "s2" });

    files["players/taro"] = [];
    await pullFromDataRepo(config);
    expect(await db.reports.get("taro")).toBeUndefined();
  });
});
