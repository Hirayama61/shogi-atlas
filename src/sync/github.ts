import { normalizeAnalysis, type AnalysisIndex, type AnalysisRecord } from "../core/analysis";
import { normalizeGame, normalizeSummary } from "../core/normalize";
import type { ReportRecord } from "../core/report";
import { applySelf, normalizeSelfIds } from "../core/self";
import type { GameRecord, GameSummary } from "../core/types";
import { upsertGames, db, getSelfIds, setSelfIds } from "../db/db";

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
export async function fetchRaw(
  path: string,
  config: DataRepoConfig,
  accept = "application/vnd.github.raw+json",
): Promise<string | null> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}?ref=${encodeURIComponent(config.branch)}`;
  const headers: Record<string, string> = {
    Accept: accept,
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
  phase: "index" | "games" | "analyses" | "reports" | "done";
  done: number;
  total: number;
}

/**
 * データリポジトリの index.json を読み、ローカルにない対局だけ取り込む。
 */
export async function pullFromDataRepo(
  config: DataRepoConfig,
  onProgress?: (p: PullProgress) => void,
): Promise<{ added: number; updated: number; total: number; analyses: number }> {
  onProgress?.({ phase: "index", done: 0, total: 0 });
  const indexText = await fetchRaw("index.json", config);
  if (!indexText) return { added: 0, updated: 0, total: 0, analyses: 0 };
  const parsed = JSON.parse(indexText) as { games?: unknown[]; self?: unknown };
  const summaries = (parsed.games ?? [])
    .map(normalizeSummary)
    .filter((s): s is GameSummary => s !== null);
  // 自分の ID 一覧が変わったら全局を取り直す (書き込みで画面の読み出しをやり直させるため)
  const selfChanged = setSelfIds(normalizeSelfIds(parsed.self));
  const remoteIds = summaries.map((g) => g.id);
  const local = await db.games.where("id").anyOf(remoteIds).toArray();
  const localById = new Map(local.map((g) => [g.id, g] as const));
  const missing = selfChanged
    ? summaries
    : summaries.filter((s) => needsFetch(localById.get(s.id), s));

  const fetched: GameRecord[] = [];
  let done = 0;
  const CONCURRENCY = 6;
  const queue = [...missing];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const summary = queue.shift()!;
        const text = await fetchRaw(`games/${summary.id}.json`, config);
        const game = text ? normalizeGame(JSON.parse(text)) : null;
        if (game) fetched.push(game);
        done++;
        onProgress?.({ phase: "games", done, total: missing.length });
      }
    }),
  );
  const result = await upsertGames(fetched);

  // エンジン解析 (無ければ飛ばす)
  let analysesAdded = 0;
  const analysisIndexText = await fetchRaw("analysis/index.json", config);
  if (analysisIndexText) {
    const analysisIndex = JSON.parse(analysisIndexText) as Partial<AnalysisIndex>;
    const entries = Object.entries(analysisIndex.analyses ?? {});
    const localAnalyses = await db.analyses
      .where("id")
      .anyOf(entries.map(([id]) => id))
      .toArray();
    const localAt = new Map(localAnalyses.map((a) => [a.id, a.analyzedAt] as const));
    const need = entries.filter(([id, at]) => localAt.get(id) !== at).map(([id]) => id);
    const got: AnalysisRecord[] = [];
    let doneA = 0;
    const queueA = [...need];
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (queueA.length) {
          const id = queueA.shift()!;
          const text = await fetchRaw(`analysis/${id}.json`, config);
          const a = text ? normalizeAnalysis(JSON.parse(text)) : null;
          if (a) got.push(a);
          doneA++;
          onProgress?.({ phase: "analyses", done: doneA, total: need.length });
        }
      }),
    );
    if (got.length) await db.analyses.bulkPut(got);
    analysesAdded = got.length;
  }

  const selfIds = getSelfIds();
  const named = summaries.map((s) => applySelf(s, selfIds));
  await pullReports(config, trackedPlayers(named), (doneR, totalR) =>
    onProgress?.({ phase: "reports", done: doneR, total: totalR }),
  );

  onProgress?.({ phase: "done", done, total: missing.length });
  return { ...result, total: summaries.length, analyses: analysesAdded };
}

/** 登録した対局者 (先手か後手の名前がその対局のタグに入っている人) */
export function trackedPlayers(summaries: GameSummary[]): string[] {
  const names = new Set<string>();
  for (const s of summaries) {
    for (const n of [s.black, s.white]) if (n && s.tags.includes(n)) names.add(n);
  }
  return [...names].sort();
}

interface DirEntry {
  name: string;
  type: string;
  sha: string;
}

/** Contents API でディレクトリの中身を取る。無ければ空 */
async function listDir(path: string, config: DataRepoConfig): Promise<DirEntry[]> {
  const text = await fetchRaw(path, config, "application/vnd.github+json");
  if (!text) return [];
  const parsed = JSON.parse(text) as unknown;
  return Array.isArray(parsed) ? (parsed as DirEntry[]) : [];
}

/**
 * 登録した対局者ごとに players/<名前>/report.md を取る。
 * 先にディレクトリの一覧を見て、レポートがある人だけ、blob の SHA が変わったときだけ取る
 * (無い人に 404 を出さないため)。データリポジトリから消えたレポートはローカルからも消す。
 */
async function pullReports(
  config: DataRepoConfig,
  names: string[],
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  const tracked = new Set(names);
  const dirs = (tracked.size ? await listDir("players", config) : []).filter(
    (e) => e.type === "dir" && tracked.has(e.name),
  );
  const local = new Map((await db.reports.toArray()).map((r) => [r.name, r] as const));
  const got: ReportRecord[] = [];
  const present = new Set<string>();
  let done = 0;
  for (const dir of dirs) {
    const base = `players/${encodeURIComponent(dir.name)}`;
    const file = (await listDir(base, config)).find(
      (e) => e.type === "file" && e.name === "report.md",
    );
    if (file) {
      present.add(dir.name);
      if (local.get(dir.name)?.hash !== file.sha) {
        const text = await fetchRaw(`${base}/report.md`, config);
        if (text !== null) {
          got.push({
            name: dir.name,
            markdown: text,
            hash: file.sha,
            fetchedAt: new Date().toISOString(),
          });
        }
      }
    }
    onProgress(++done, dirs.length);
  }
  if (got.length) await db.reports.bulkPut(got);
  const gone = [...local.keys()].filter((n) => !present.has(n));
  if (gone.length) await db.reports.bulkDelete(gone);
}

/** ローカルに無い、取り込み日時が変わった、解析の版が変わった、のいずれかなら取り直す */
export function needsFetch(local: GameSummary | undefined, remote: GameSummary): boolean {
  if (!local) return true;
  return local.importedAt !== remote.importedAt || local.parser !== remote.parser;
}
