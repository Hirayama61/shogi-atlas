// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PARSER_VERSION } from "../core/normalize";
import { parseKifu } from "../core/parse";
import { toSummary } from "../core/types";
import { USI_SHIKEN_VS_FUNA, WARS_KIF } from "../core/__tests__/fixtures";
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
      return new Response(JSON.stringify(files[path]), { status: 200 });
    }),
  );
  return calls;
}

describe("pullFromDataRepo", () => {
  beforeEach(async () => {
    await db.games.clear();
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
    expect(await pullFromDataRepo(config)).toEqual({ added: 2, updated: 0, total: 2 });
    expect(calls).toContain(`games/${a.id}.json`);

    calls.length = 0;
    expect(await pullFromDataRepo(config)).toEqual({ added: 0, updated: 0, total: 2 });
    expect(calls).toEqual(["index.json"]);
  });

  it("解析の版が変わったものは取り直す", async () => {
    const a = await parseKifu(WARS_KIF, { source, importedAt: "2026-01-01T00:00:00Z" });
    await db.games.put({ ...a, parser: PARSER_VERSION - 1 });
    const calls = mockRepo({
      "index.json": { schema: 1, updatedAt: "x", games: [toSummary(a)] },
      [`games/${a.id}.json`]: a,
    });
    expect(await pullFromDataRepo(config)).toEqual({ added: 0, updated: 1, total: 1 });
    expect(calls).toContain(`games/${a.id}.json`);
    expect((await db.games.get(a.id))?.parser).toBe(PARSER_VERSION);
  });

  it("index.json が無ければ何もしない、壊れたレコードは無視する", async () => {
    mockRepo({});
    expect(await pullFromDataRepo(config)).toEqual({ added: 0, updated: 0, total: 0 });
    vi.unstubAllGlobals();
    mockRepo({
      "index.json": { schema: 1, updatedAt: "x", games: [{ id: "bad" }, null] },
      "games/bad.json": { id: "bad" },
    });
    expect(await pullFromDataRepo(config)).toEqual({ added: 0, updated: 0, total: 1 });
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
});
