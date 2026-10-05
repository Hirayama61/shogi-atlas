import type { GameIndex, GameRecord } from "../core/types";
import { upsertGames, db } from "../db/db";

export interface DataRepoConfig {
  owner: string;
  repo: string;
  branch: string;
  /** Fine-grained PAT。データリポジトリの Contents: Read のみを付与する。 */
  token: string;
  /** false のときはトークンを localStorage に保存しない */
  remember: boolean;
}

const STORAGE_KEY = "shogi-atlas.dataRepo";
const SESSION_TOKEN_KEY = "shogi-atlas.dataRepo.token";

export const DEFAULT_CONFIG: DataRepoConfig = {
  owner: "Hirayama61",
  repo: "shogi-atlas-data",
  branch: "main",
  token: "",
  remember: true,
};

export function loadConfig(): DataRepoConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const base = saved
      ? { ...DEFAULT_CONFIG, ...(JSON.parse(saved) as Partial<DataRepoConfig>) }
      : { ...DEFAULT_CONFIG };
    if (!base.token) base.token = sessionStorage.getItem(SESSION_TOKEN_KEY) ?? "";
    return base;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: DataRepoConfig): void {
  try {
    const { token, ...rest } = config;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config.remember ? { ...rest, token } : rest));
    if (config.remember) sessionStorage.removeItem(SESSION_TOKEN_KEY);
    else sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch {
    // ストレージが使えない環境では何もしない
  }
}

export class GitHubFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GitHubFetchError";
  }
}

/** Contents API から raw のファイル内容を取る。404 なら null。 */
export async function fetchRaw(path: string, config: DataRepoConfig): Promise<string | null> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}?ref=${encodeURIComponent(config.branch)}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.raw+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  const res = await fetch(url, { headers, cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) {
    const detail =
      res.status === 401
        ? "トークンが無効です"
        : res.status === 403
          ? "権限が足りないか、レート制限です"
          : res.statusText;
    throw new GitHubFetchError(`${path}: ${res.status} ${detail}`, res.status);
  }
  return res.text();
}

export interface PullProgress {
  phase: "index" | "games" | "done";
  done: number;
  total: number;
}

/**
 * データリポジトリの index.json を読み、ローカルにない対局だけ取り込む。
 */
export async function pullFromDataRepo(
  config: DataRepoConfig,
  onProgress?: (p: PullProgress) => void,
): Promise<{ added: number; updated: number; total: number }> {
  onProgress?.({ phase: "index", done: 0, total: 0 });
  const indexText = await fetchRaw("index.json", config);
  if (!indexText) return { added: 0, updated: 0, total: 0 };
  const index = JSON.parse(indexText) as GameIndex;
  const remoteIds = index.games.map((g) => g.id);
  const local = await db.games.where("id").anyOf(remoteIds).toArray();
  const localById = new Map(local.map((g) => [g.id, g] as const));
  // importedAt が変わったものは再取得対象にする (ラベル付けの更新など)
  const missing = index.games.filter((s) => {
    const l = localById.get(s.id);
    return !l || l.importedAt !== s.importedAt;
  });

  const fetched: GameRecord[] = [];
  let done = 0;
  const CONCURRENCY = 6;
  const queue = [...missing];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const summary = queue.shift()!;
        const text = await fetchRaw(`games/${summary.id}.json`, config);
        if (text) fetched.push(JSON.parse(text) as GameRecord);
        done++;
        onProgress?.({ phase: "games", done, total: missing.length });
      }
    }),
  );
  const result = await upsertGames(fetched);
  onProgress?.({ phase: "done", done, total: missing.length });
  return { ...result, total: index.games.length };
}
