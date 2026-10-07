import { parseInline, parseMarkdown, splitReport, type Block } from "../core/report";

/** 文字幅の見積もり (半角 0.6、全角 1.0 文字分)。画像は環境のフォントで描くので少し余裕を見て折り返す */
export function textWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += (ch.codePointAt(0)! < 0x100 ? 0.6 : 1) * size;
  return w;
}

/** 幅に収まるように折り返す */
export function wrapText(text: string, width: number, size: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of text) {
    if (line && textWidth(line + ch, size) > width) {
      lines.push(line);
      line = ch === " " ? "" : ch;
    } else line += ch;
  }
  if (line) lines.push(line);
  return lines;
}

interface DigestLine {
  text: string;
  bold?: boolean;
  indent: number;
}

const plain = (text: string) =>
  parseInline(text)
    .map((p) => p.text)
    .join("");

function flatten(blocks: Block[], indent: number, out: DigestLine[]): void {
  for (const b of blocks) {
    if (b.kind === "heading") out.push({ text: plain(b.text), bold: true, indent });
    else if (b.kind === "paragraph") out.push({ text: plain(b.text), indent });
    else if (b.kind === "list") {
      b.items.forEach((item, i) => {
        const mark = b.ordered ? `${b.start + i}. ` : "・";
        out.push({ text: mark + plain(item.text), indent });
        flatten(item.children, indent + 1, out);
      });
    }
  }
}

/** 対策レポートの要点 (画面の「対策の要点」と同じ切り出し) を、画像に載せる行にする */
export function digestLines(markdown: string): DigestLine[] {
  const out: DigestLine[] = [];
  flatten(splitReport(parseMarkdown(markdown)).digest, 0, out);
  return out.filter((l) => l.text.trim() !== "");
}
