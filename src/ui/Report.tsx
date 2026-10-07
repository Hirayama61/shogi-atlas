import { Fragment, useMemo, useState, type ReactNode } from "react";
import {
  gameIdResolver,
  parseInline,
  parseMarkdown,
  splitGameRefs,
  splitReport,
  type Block,
  type ReportRecord,
} from "../core/report";
import { isReportUnseen, markReportSeen } from "./reportSeen";
import { hashFor } from "./router";

type Resolve = (prefix: string) => string | null;

/** 「N手目」は、その手を指す前の局面を開く (痛かった手の「局面を開く」と同じ) */
function refHash(ref: { gameId: string; ply?: number }): string {
  return hashFor({
    kind: "game",
    id: ref.gameId,
    ply: ref.ply !== undefined ? Math.max(0, ref.ply - 1) : undefined,
  });
}

function Text({ text, resolve }: { text: string; resolve: Resolve }) {
  return (
    <>
      {splitGameRefs(text, resolve).map((seg, i) =>
        seg.ref ? (
          <a key={i} className="game-ref" href={refHash(seg.ref)}>
            {seg.text}
          </a>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        ),
      )}
    </>
  );
}

function Inline({ text, resolve }: { text: string; resolve: Resolve }) {
  return (
    <>
      {parseInline(text).map((part, i) =>
        part.kind === "code" ? (
          <code key={i}>{part.text}</code>
        ) : part.kind === "strong" ? (
          <strong key={i}>
            <Text text={part.text} resolve={resolve} />
          </strong>
        ) : (
          <Text key={i} text={part.text} resolve={resolve} />
        ),
      )}
    </>
  );
}

function Blocks({ blocks, resolve }: { blocks: Block[]; resolve: Resolve }): ReactNode {
  return blocks.map((b, i) => {
    switch (b.kind) {
      case "heading": {
        // ページの見出しより下げる (h1 → h3)
        const Tag = `h${Math.min(6, b.level + 2)}` as "h3";
        return (
          <Tag key={i}>
            <Inline text={b.text} resolve={resolve} />
          </Tag>
        );
      }
      case "paragraph":
        return (
          <p key={i}>
            <Inline text={b.text} resolve={resolve} />
          </p>
        );
      case "hr":
        return <hr key={i} />;
      case "list": {
        const items = b.items.map((item, j) => (
          <li key={j}>
            <Inline text={item.text} resolve={resolve} />
            <Blocks blocks={item.children} resolve={resolve} />
          </li>
        ));
        return b.ordered ? (
          <ol key={i} start={b.start}>
            {items}
          </ol>
        ) : (
          <ul key={i}>{items}</ul>
        );
      }
    }
  });
}

/**
 * 対局者ページの対策レポート。要点 (「## 要点」の節。無ければ第 1 節と作戦の小見出し) と全文をそれぞれ畳んで出す。
 * 要点の節は全文の側には出さない。
 * 更新されていれば「新しいレポート」の印を付け、どちらかを開くと消す。
 * 本文中の対局 ID (と「N手目」) は、その対局者の対局に引けたものだけ棋譜へのリンクにする。
 */
export function ReportPanel({ report, gameIds }: { report: ReportRecord; gameIds: string[] }) {
  const blocks = useMemo(() => parseMarkdown(report.markdown), [report.markdown]);
  const { digest, body } = useMemo(() => splitReport(blocks), [blocks]);
  const resolve = useMemo(() => gameIdResolver(gameIds), [gameIds]);
  const [seenHash, setSeenHash] = useState<string | null>(null);
  const unseen = seenHash !== report.hash && isReportUnseen(report);
  const onToggle = (open: boolean) => {
    if (!open || !unseen) return;
    markReportSeen(report);
    setSeenHash(report.hash);
  };
  return (
    <div className="panel report">
      <strong>対策レポート</strong>
      {unseen && <span className="chip new">新しいレポート</span>}
      {digest.length > 0 && (
        <details className="report-part" onToggle={(e) => onToggle(e.currentTarget.open)}>
          <summary>対策の要点</summary>
          <div className="report-body">
            <Blocks blocks={digest} resolve={resolve} />
          </div>
        </details>
      )}
      <details className="report-part" onToggle={(e) => onToggle(e.currentTarget.open)}>
        <summary>全文</summary>
        <div className="report-body">
          <Blocks blocks={body} resolve={resolve} />
        </div>
      </details>
    </div>
  );
}
