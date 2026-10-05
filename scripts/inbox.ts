/**
 * Issue 受信箱の本文から棋譜とメタ情報を取り出すロジック (純粋関数)。
 * GitHub の Issue フォーム (### 見出し) と、見出しなしの自由形式の両方を受け付ける。
 */
import { splitKifuBlocks } from "../src/core/parse";

export interface InboxEntry {
  kifuBlocks: string[];
  url?: string;
  tags: string[];
  memo?: string;
}

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

  const kifuText = cleanValue(sections.kifu) ?? "";
  const url = cleanValue(sections.url);
  const tagsText = cleanValue(sections.tags) ?? "";
  const tags = Array.from(
    new Set([
      ...tagsText
        .split(/[,、\n\s]+/)
        .map((t) => t.trim())
        .filter(Boolean),
      ...labels.filter((l) => !["kifu", "needs-fix", "duplicate"].includes(l)),
    ]),
  );
  const entry: InboxEntry = { kifuBlocks: splitKifuBlocks(kifuText), tags };
  if (url && /^https?:\/\//.test(url)) entry.url = url.split(/\s+/)[0];
  const memo = cleanValue(sections.memo);
  if (memo) entry.memo = memo;
  return entry;
}
