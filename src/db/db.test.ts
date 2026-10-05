// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { parseKifu } from "../core/parse";
import { USI_SHIKEN_VS_FUNA, WARS_KIF } from "../core/__tests__/fixtures";
import { db, findGamesByPosition, upsertGames } from "./db";

const source = { kind: "paste" as const };

describe("db", () => {
  beforeEach(async () => {
    await db.games.clear();
  });

  it("追加と更新を区別し、局面キーで引ける", async () => {
    const a = await parseKifu(WARS_KIF, { source });
    const b = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
    expect(await upsertGames([a, b])).toEqual({ added: 2, updated: 0 });
    expect(await upsertGames([a])).toEqual({ added: 0, updated: 1 });
    expect(await db.games.count()).toBe(2);

    // 両方とも 1 手目は ７六歩なので同じ局面を通る
    const hits = await findGamesByPosition(a.positions[1]!);
    expect(hits.map((g) => g.id).sort()).toEqual([a.id, b.id].sort());
    expect(await findGamesByPosition(a.positions[10]!)).toHaveLength(1);
  });

  it("古い形のレコードも読み出し時に正規化される", async () => {
    const a = await parseKifu(WARS_KIF, { source });
    const legacy = { ...a, opening: { shape: "taikokei" } } as unknown as typeof a;
    delete (legacy as Partial<typeof a>).parser;
    await db.games.put(legacy);
    const read = await db.games.get(a.id);
    expect(read?.parser).toBe(0);
    expect(read?.opening.blackOpening).toBe("不明");
  });
});
