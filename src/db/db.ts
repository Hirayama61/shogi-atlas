import Dexie, { type EntityTable } from "dexie";
import { normalizeAnalysis, type AnalysisRecord } from "../core/analysis";
import { normalizeGame } from "../core/normalize";
import { normalizeReport, type ReportRecord } from "../core/report";
import { applySelf, normalizeSelfIds } from "../core/self";
import type { GameRecord } from "../core/types";

const SELF_KEY = "shogi-atlas.self";

function loadSelfIds(): Set<string> {
  try {
    return new Set(normalizeSelfIds(JSON.parse(localStorage.getItem(SELF_KEY) ?? "[]")));
  } catch {
    return new Set();
  }
}

/** 自分の ID 一覧 (同期で index.json の `self` から取り込む)。読み出し時に対局者名を「自分」にする */
let selfIds = loadSelfIds();

export function getSelfIds(): ReadonlySet<string> {
  return selfIds;
}

/** 自分の ID 一覧を差し替えて保存する。変わったら true */
export function setSelfIds(ids: string[]): boolean {
  const next = normalizeSelfIds(ids);
  const changed = next.join("\n") !== [...selfIds].sort().join("\n");
  selfIds = new Set(next);
  try {
    localStorage.setItem(SELF_KEY, JSON.stringify(next));
  } catch {
    // ストレージが使えない環境では、この起動のあいだだけ効かせる
  }
  return changed;
}

/**
 * ブラウザ内の棋譜ストア。
 * positions は multiEntry インデックスなので、局面キーから「その局面を通った対局」を直接引ける。
 * 読み出し時に normalizeGame を通すので、古い形のレコードが残っていても画面側は現在の型として扱える。
 * 同じく読み出し時に自分の ID を「自分」に置き換える (保存されている対局は書き換えない)。
 * 読んだ対局をそのまま書き戻すと置き換えた名前が保存されてしまうので、書くのは同期で取ってきた対局だけにする。
 */
export class AtlasDB extends Dexie {
  games!: EntityTable<GameRecord, "id">;
  analyses!: EntityTable<AnalysisRecord, "id">;
  reports!: EntityTable<ReportRecord, "name">;

  constructor() {
    super("shogi-atlas");
    this.version(1).stores({
      games: "id, black, white, startedAt, importedAt, result, opening.shape, *tags, *positions",
    });
    this.version(2).stores({
      games: "id, black, white, startedAt, importedAt, result, opening.shape, *tags, *positions",
      analyses: "id, analyzedAt",
    });
    this.version(3).stores({
      games: "id, black, white, startedAt, importedAt, result, opening.shape, *tags, *positions",
      analyses: "id, analyzedAt",
      reports: "name",
    });
    this.games.hook("reading", (obj) => {
      const g = normalizeGame(obj);
      return g ? applySelf(g, selfIds) : obj;
    });
    this.analyses.hook("reading", (obj) => normalizeAnalysis(obj) ?? obj);
    this.reports.hook("reading", (obj) => normalizeReport(obj) ?? obj);
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
