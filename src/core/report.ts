/**
 * 対策レポート (データリポジトリの players/<名前>/report.md)。
 * 画面で使う分だけの小さな Markdown 解析と、本文中の対局への参照の検出。
 * 生 HTML は扱わない (描画側は解析結果を React の要素にするだけなので、HTML は文字としてそのまま出る)。
 */

export interface ReportRecord {
  /** 対局者名 (= データリポジトリの players/<名前>) */
  name: string;
  markdown: string;
  /** データリポジトリでの blob の SHA。取り直しと更新の印に使う */
  hash: string;
  fetchedAt: string;
}

export function normalizeReport(raw: unknown): ReportRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ReportRecord>;
  if (typeof r.name !== "string" || typeof r.markdown !== "string") return null;
  return {
    name: r.name,
    markdown: r.markdown,
    hash: typeof r.hash === "string" ? r.hash : "",
    fetchedAt: typeof r.fetchedAt === "string" ? r.fetchedAt : "",
  };
}

export interface ListItem {
  text: string;
  /** 項目の下に字下げで続く段落や入れ子のリスト */
  children: Block[];
}

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "hr" };

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

const isBlank = (l: string) => l.trim() === "";
const indentOf = (l: string) => /^\s*/.exec(l)![0].length;
const isOrderedMarker = (m: string) => /\d/.test(m);

/** 見出し・段落・リスト (入れ子と番号つき)・区切り線だけを解く */
export function parseMarkdown(markdown: string): Block[] {
  return parseLines(markdown.replace(/\r\n?/g, "\n").split("\n"));
}

function nextNonBlank(lines: string[], from: number): number {
  let j = from;
  while (j < lines.length && isBlank(lines[j]!)) j++;
  return j;
}

function parseLines(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line)) {
      i++;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      blocks.push({ kind: "heading", level: h[1]!.length, text: h[2]! });
      i++;
      continue;
    }
    if (HR.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }
    const li = LIST_ITEM.exec(line);
    if (li) {
      const indent = li[1]!.length;
      const ordered = isOrderedMarker(li[2]!);
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]!);
        if (!m || m[1]!.length !== indent || isOrderedMarker(m[2]!) !== ordered) break;
        i++;
        const body: string[] = [];
        while (i < lines.length) {
          const l = lines[i]!;
          if (isBlank(l)) {
            const j = nextNonBlank(lines, i);
            if (j < lines.length && indentOf(lines[j]!) > indent) {
              body.push("");
              i++;
              continue;
            }
            break;
          }
          if (indentOf(l) <= indent) break;
          body.push(l);
          i++;
        }
        const cut = Math.min(...body.filter((l) => !isBlank(l)).map(indentOf));
        items.push({
          text: m[3]!,
          children: parseLines(body.map((l) => (isBlank(l) ? "" : l.slice(cut)))),
        });
        // 空行をはさんで同じ種類の項目が続くなら同じリスト
        const j = nextNonBlank(lines, i);
        const next = j < lines.length ? LIST_ITEM.exec(lines[j]!) : null;
        if (next && next[1]!.length === indent && isOrderedMarker(next[2]!) === ordered) i = j;
        else break;
      }
      const start = ordered ? Number(/\d+/.exec(li[2]!)![0]) : 1;
      blocks.push({ kind: "list", ordered, start, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i]!;
      if (isBlank(l) || HEADING.test(l) || HR.test(l) || LIST_ITEM.test(l)) break;
      para.push(l.trim());
      i++;
    }
    blocks.push({ kind: "paragraph", text: para.join(" ") });
  }
  return blocks;
}

export type Inline = { kind: "text" | "strong" | "code"; text: string };

/** `**太字**` と `` `コード` `` だけを解く */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: "strong", text: m[1] });
    else out.push({ kind: "code", text: m[2]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** 本文の一部。ref があれば対局への参照 (ply は「N手目」の N。無ければ対局の頭) */
export interface RefSegment {
  text: string;
  ref?: { gameId: string; ply?: number };
}

/**
 * 本文の中の対局 ID (16 桁の 16 進、または 6 桁以上の先頭部分) と、直後の「N手目」を参照にする。
 * ID は `resolve` が一意に対局に引けたものだけ参照にする (数字だけの 6 桁などを誤って拾わないため)。
 */
export function splitGameRefs(
  text: string,
  resolve: (prefix: string) => string | null,
): RefSegment[] {
  const out: RefSegment[] = [];
  const re = /(?<![0-9a-zA-Z])([0-9a-f]{6,16})(?![0-9a-zA-Z])(?:\s*(\d+)\s*手目)?/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const gameId = resolve(m[1]!);
    if (!gameId) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    const ref = m[2] ? { gameId, ply: Number(m[2]) } : { gameId };
    out.push({ text: m[0], ref });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** ID の先頭部分から対局を引く。一意に決まらなければ null */
export function gameIdResolver(ids: Iterable<string>): (prefix: string) => string | null {
  const all = [...ids];
  return (prefix) => {
    const hit = all.filter((id) => id.startsWith(prefix));
    return hit.length === 1 ? hit[0]! : null;
  };
}

/**
 * 対局前に見る要点: 最初の「## 」の節と、「作戦」を含む「## 」の節の小見出し (「### 」) と
 * その下の最初の項目。どちらも無ければ空。
 */
export function reportDigest(blocks: Block[]): Block[] {
  const sections: Block[][] = [];
  for (const b of blocks) {
    if (b.kind === "heading" && b.level <= 2) sections.push([b]);
    else sections.at(-1)?.push(b);
  }
  const level2 = sections.filter((s) => s[0]?.kind === "heading" && s[0].level === 2);
  const out: Block[] = [];
  const first = level2[0];
  if (first) out.push(...first.filter((b) => b.kind !== "hr"));
  const strategy = level2.find(
    (s) => s !== first && s[0]?.kind === "heading" && s[0].text.includes("作戦"),
  );
  if (strategy) {
    out.push(strategy[0]!);
    strategy.forEach((b, i) => {
      if (b.kind !== "heading" || b.level !== 3) return;
      out.push(b);
      const next = strategy[i + 1];
      if (next?.kind === "list" && next.items[0]) {
        out.push({ ...next, items: [{ ...next.items[0], children: [] }] });
      }
    });
  }
  return out;
}
