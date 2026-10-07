/**
 * データリポジトリの games/*.json を元テキスト (raw) から解析し直し、index.json を作り直す。
 * パーサーや戦型判定を改良したあとに実行する。タグとメモ、index.json の自分の ID 一覧 (`self`) は既存のものを引き継ぐ。
 *
 *   DATA_DIR=../shogi-atlas-data pnpm reindex
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseKifu } from "../src/core/parse";
import { normalizeSelfIds } from "../src/core/self";
import { toSummary, type GameIndex, type GameRecord } from "../src/core/types";

const dataDir = path.resolve(process.env.DATA_DIR ?? "../shogi-atlas-data");

async function main(): Promise<void> {
  const dir = path.join(dataDir, "games");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const index: GameIndex = { schema: 1, updatedAt: new Date().toISOString(), games: [] };
  const indexFile = path.join(dataDir, "index.json");
  if (existsSync(indexFile)) {
    const self = normalizeSelfIds(
      (JSON.parse(await readFile(indexFile, "utf8")) as { self?: unknown }).self,
    );
    if (self.length) index.self = self;
  }
  let changed = 0;
  for (const file of files) {
    const before = JSON.parse(await readFile(path.join(dir, file), "utf8")) as GameRecord;
    const after = await parseKifu(before.raw, {
      source: before.source,
      importedAt: before.importedAt,
      tags: before.tags,
      memo: before.memo,
    });
    if (after.id !== before.id) {
      console.warn(`${file}: ID が変わります (${before.id} → ${after.id})。元の ID を維持します。`);
      after.id = before.id;
    }
    const beforeText = JSON.stringify({ ...before, importedAt: "" });
    const afterText = JSON.stringify({ ...after, importedAt: "" });
    if (beforeText !== afterText) {
      // 変更があった場合だけ importedAt を更新し、アプリ側が再取得できるようにする
      after.importedAt = new Date().toISOString();
      await writeFile(path.join(dir, file), JSON.stringify(after, null, 2) + "\n");
      changed++;
    }
    index.games.push(toSummary(after));
  }
  index.games.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  await writeFile(indexFile, JSON.stringify(index, null, 2) + "\n");
  console.log(`${files.length} 局を再解析、${changed} 局を更新`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
