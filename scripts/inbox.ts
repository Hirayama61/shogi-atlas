/**
 * Issue 受信箱のテキストから棋譜とメタ情報を取り出すロジック (純粋関数)。
 *
 * 運用: 対局者ごとに Issue を 1 本立て (タイトル = 対局者名)、本文やコメントに棋譜を貼っていく。
 * Issue フォーム (### 見出し) の形式と、見出しなしで棋譜をそのまま貼った形式の両方を受け付ける。
 */
import { splitKifuBlocks } from "../src/core/parse";
import { normalizeSelfIds, SELF_LABEL } from "../src/core/self";

export interface InboxEntry {
  kifuBlocks: string[];
  url?: string;
  tags: string[];
  memo?: string;
}

/** 受信箱の制御に使うラベル。タグには含めない。 */
export const CONTROL_LABELS = ["kifu", "needs-fix", "not-kifu", "duplicate"];

const FORM_HEADINGS: Record<string, keyof RawSections> = {
  棋譜: "kifu",
  出典url: "url",
  出典: "url",
  タグ: "tags",
  メモ: "memo",
};

interface RawSections {
  kifu?: string;
  url?: string;
  tags?: string;
  memo?: string;
}

function stripFences(text: string): string {
  return text.replace(/^```[a-zA-Z]*\s*\n?/gm, "").replace(/^```\s*$/gm, "");
}

function cleanValue(text: string | undefined): string | undefined {
  const v = stripFences(text ?? "").trim();
  if (!v || v === "_No response_") return undefined;
  return v;
}

/**
 * 自由形式のテキストから「メモ: ...」「url: ...」の行を抜き出し、残りを棋譜として返す。
 */
function extractInlineMeta(text: string): { kifu: string; memo?: string; url?: string } {
  const memos: string[] = [];
  let url: string | undefined;
  const rest: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(メモ|memo|url|出典)\s*[:：]\s*(.*)$/i.exec(line);
    if (m && m[2] !== undefined) {
      const key = m[1]!.toLowerCase();
      if (key === "url" || key === "出典") url = m[2].trim();
      else memos.push(m[2].trim());
      continue;
    }
    rest.push(line);
  }
  const out: { kifu: string; memo?: string; url?: string } = { kifu: rest.join("\n") };
  if (memos.length) out.memo = memos.filter(Boolean).join("\n");
  if (url) out.url = url;
  return out;
}

/**
 * 棋譜として処理すべきテキストかどうかの簡易判定。
 * 普通の文章やメモのコメントまで「読めませんでした」と返さないためのもの。
 */
export function looksLikeKifu(block: string): boolean {
  return (
    /手数----|^\s*\d+\s+(同\u3000|[１-９1-9][一二三四五六七八九1-9]).*[歩香桂銀金角飛玉王と杏圭全馬龍竜]/m.test(
      block,
    ) ||
    /^(position\s|startpos|sfen\s)/m.test(block) ||
    /^[+-]\d{4}[A-Z]{2}/m.test(block) ||
    /^[☗☖▲△][１-９1-9]/m.test(block) ||
    /"moves"\s*:/.test(block)
  );
}

/** Issue のタイトルから対局者名を取り出す。「棋譜: 」のような接頭辞は外す。 */
export function playerFromTitle(title: string): string | undefined {
  const name = title.replace(/^(棋譜|kifu)\s*[:：]\s*/i, "").trim();
  return name || undefined;
}

/**
 * `自分` ラベルの Issue のタイトル (= 自分の ID) の一覧。`index.json` の `self` に書く。
 * 閉じた Issue も含める (Issue を閉じても自分の ID が画面に戻らないように)。
 */
export function selfIdsFromIssues(
  issues: Array<{ title: string; labels: Array<{ name: string }>; pull_request?: unknown }>,
): string[] {
  return normalizeSelfIds(
    issues
      .filter((i) => !i.pull_request && i.labels.some((l) => l.name === SELF_LABEL))
      .map((i) => playerFromTitle(i.title)),
  );
}

export function parseIssueBody(body: string, labels: string[] = []): InboxEntry {
  const sections: RawSections = {};
  const headingRe = /^###\s+(.+?)\s*$/gm;
  const matches = Array.from(body.matchAll(headingRe));

  if (matches.length === 0) {
    sections.kifu = body;
  } else {
    matches.forEach((m, i) => {
      const title = (m[1] ?? "").toLowerCase().replace(/\s+/g, "");
      const key = FORM_HEADINGS[title];
      const start = (m.index ?? 0) + m[0].length;
      const end = matches[i + 1]?.index ?? body.length;
      const value = body.slice(start, end);
      if (key) sections[key] = value;
      else if (!sections.kifu && /手数----|position |先手[：:]/.test(value)) sections.kifu = value;
    });
  }

  const inline = extractInlineMeta(cleanValue(sections.kifu) ?? "");
  const url = cleanValue(sections.url) ?? inline.url;
  const tagsText = cleanValue(sections.tags) ?? "";
  const tags = Array.from(
    new Set([
      ...tagsText
        .split(/[,、\n\s]+/)
        .map((t) => t.trim())
        .filter(Boolean),
      ...labels.filter((l) => !CONTROL_LABELS.includes(l)),
    ]),
  );
  const entry: InboxEntry = {
    kifuBlocks: splitKifuBlocks(inline.kifu).filter(looksLikeKifu),
    tags,
  };
  if (url && /^https?:\/\//.test(url)) entry.url = url.split(/\s+/)[0];
  const memo = [cleanValue(sections.memo), inline.memo].filter(Boolean).join("\n");
  if (memo) entry.memo = memo;
  return entry;
}
