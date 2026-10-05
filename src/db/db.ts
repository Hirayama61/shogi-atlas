import Dexie, { type EntityTable } from "dexie";
import { normalizeGame } from "../core/normalize";
import type { GameRecord } from "../core/types";

/**
 * ブラウザ内の棋譜ストア。
 * positions は multiEntry インデックスなので、局面キーから「その局面を通った対局」を直接引ける。
 * 読み出し時に normalizeGame を通すので、古い形のレコードが残っていても画面側は現在の型として扱える。
 */
export class AtlasDB extends Dexie {
  games!: EntityTable<GameRecord, "id">;

  constructor() {
    super("shogi-atlas");
    this.version(1).stores({
      games: "id, black, white, startedAt, importedAt, result, opening.shape, *tags, *positions",
    });
    this.games.hook("reading", (obj) => normalizeGame(obj) ?? obj);
  }
}

export const db = new AtlasDB();

export async function findGamesByPosition(positionKey: string): Promise<GameRecord[]> {
  return db.games.where("positions").equals(positionKey).toArray();
}

export async function upsertGames(
  games: GameRecord[],
): Promise<{ added: number; updated: number }> {
  const ids = games.map((g) => g.id);
  const existing = new Set((await db.games.where("id").anyOf(ids).primaryKeys()) as string[]);
  await db.games.bulkPut(games);
  const added = games.filter((g) => !existing.has(g.id)).length;
  return { added, updated: games.length - added };
}
