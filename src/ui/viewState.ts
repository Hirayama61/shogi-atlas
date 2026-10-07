import { useEffect, useRef } from "react";

/**
 * 履歴エントリごとの表示状態 (スクロール位置・開いている折りたたみ) を覚えて、戻ったときに復元する。
 * ハッシュが変わると画面コンポーネントが作り直されるので、ブラウザ任せでは先頭に戻ってしまう。
 *
 * 各エントリの `history.state` に鍵を付け、表示状態は sessionStorage に鍵ごとに置く。
 * アプリ内の遷移で作られたエントリには遷移元 (prev) も記録し、「1 つ戻る」で history.back() してよいかの判断に使う。
 */

interface EntryState {
  viewKey: string;
  /** 遷移元のハッシュ。URL を直接開いたエントリには無い */
  prev?: string;
}

interface ViewSnapshot {
  y: number;
  /** 開いていた details の識別子 (detailsIds) */
  open: string[];
}

const STORAGE_PREFIX = "shogi-atlas:view:";
let currentKey: string | null = null;

function entryState(): EntryState | null {
  const s = history.state as Partial<EntryState> | null;
  return s && typeof s.viewKey === "string" ? (s as EntryState) : null;
}

function newKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 今の履歴エントリに鍵を付ける (付いていればそのまま = 戻る・進むで来た) */
function ensureEntry(prev?: string): string {
  const s = entryState();
  if (s) return s.viewKey;
  const next: EntryState = { viewKey: newKey() };
  if (prev !== undefined) next.prev = prev;
  history.replaceState(next, "");
  return next.viewKey;
}

function hashOf(url: string): string {
  const i = url.indexOf("#");
  return i < 0 ? "" : url.slice(i);
}

/**
 * 画面上の details に、見出し (summary) の文字と同じ見出しの中での順番から識別子を付ける。
 * 開いたときだけ出る details (率の内訳など) があっても、ほかの details の識別子がずれない。
 */
function detailsIds(): Array<[HTMLDetailsElement, string]> {
  const seen = new Map<string, number>();
  return Array.from(document.querySelectorAll("details")).map((d) => {
    const label = d.querySelector(":scope > summary")?.textContent?.trim() ?? "";
    const n = seen.get(label) ?? 0;
    seen.set(label, n + 1);
    return [d, `${label}#${n}`];
  });
}

function saveView(key: string): void {
  const open = detailsIds()
    .filter(([d]) => d.open)
    .map(([, id]) => id);
  const snap: ViewSnapshot = { y: window.scrollY, open };
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(snap));
  } catch {
    // 保存できなくても遷移は続ける
  }
}

function loadView(key: string): ViewSnapshot | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ViewSnapshot>;
    return typeof v.y === "number" && Array.isArray(v.open) ? (v as ViewSnapshot) : null;
  } catch {
    return null;
  }
}

/** 起動時に呼ぶ。最初のエントリに鍵を付け、スクロールの復元をブラウザから引き取る */
export function startViewTracking(): void {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  currentKey = ensureEntry();
}

/**
 * hashchange のたびに、画面を描き直す前に呼ぶ。
 * 離れる画面の表示状態を保存し、新しいエントリに鍵と遷移元を付ける。
 */
export function recordNavigation(oldURL: string): void {
  if (currentKey) saveView(currentKey);
  currentKey = ensureEntry(hashOf(oldURL));
}

/** アプリ内の遷移で今の画面に来たか (history.back() で直前の画面に戻れるか) */
export function canGoBack(): boolean {
  return !!entryState()?.prev;
}

/**
 * `hash` の画面へ戻る。直前の画面がそれなら history.back() で戻り (表示状態が復元される)、
 * そうでなければ新しく開く。
 */
export function goBackTo(hash: string): void {
  if (entryState()?.prev === hash) history.back();
  else if (location.hash !== hash) location.hash = hash;
}

/**
 * 画面のデータが揃ったら (ready)、このエントリで前に保存した表示状態を 1 回だけ復元する。
 * 新しく開いた画面には保存が無いので何もしない。
 */
export function useRestoreView(ready: boolean): void {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const key = entryState()?.viewKey;
    if (!key || done.current === key) return;
    done.current = key;
    const snap = loadView(key);
    if (!snap) return;
    const open = new Set(snap.open);
    for (const [d, id] of detailsIds()) d.open = open.has(id);
    window.scrollTo(0, snap.y);
  });
}
