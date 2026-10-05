import { Record as KifuRecord, exportKIF, type ImmutablePosition } from "tsshogi";
import { formatMove } from "tsshogi";
import { JUDGEMENT_LABEL, reviewMoves, type AnalysisRecord } from "./analysis";
import { importRecord } from "./parse";
import type { GameRecord } from "./types";

/**
 * 解析結果をコメントとして埋め込んだ KIF を作る。将棋アプリに貼って検討する用。
 * 各手のコメント: 評価値 (先手視点)、損失、最善手と読み筋。
 */
export function annotatedKif(game: GameRecord, analysis: AnalysisRecord): string {
  const { record } = importRecord(game.raw);
  const reviews = new Map(reviewMoves(game, analysis).map((r) => [r.ply, r] as const));
  const byPly = new Map(analysis.plies.map((p) => [p.ply, p] as const));

  record.goto(0);
  const start = byPly.get(0);
  if (start) record.current.comment = `評価値 ${fmt(start.cp)}`;

  let node = record.first.next;
  while (node) {
    const ply = node.ply;
    const r = reviews.get(ply);
    const e = byPly.get(ply);
    if (r && e) {
      const parts = [`評価値 ${fmt(e.cp)}`];
      if (r.judgement !== "good") parts.push(`${JUDGEMENT_LABEL[r.judgement]} (損失 ${r.loss})`);
      if (r.best) {
        const before = byPly.get(ply - 1);
        const pos = positionBefore(record, ply);
        const pvText = before?.pv?.length && pos ? formatPv(pos, before.pv) : r.best;
        parts.push(`最善 ${pvText}`);
      }
      node.comment = parts.join("\n");
    }
    node = node.next;
  }
  record.goto(0);
  return exportKIF(record);
}

function fmt(cp: number): string {
  return cp > 0 ? `+${cp}` : `${cp}`;
}

function positionBefore(record: KifuRecord, ply: number): ImmutablePosition | null {
  record.goto(ply - 1);
  return record.position.clone();
}

function formatPv(position: ImmutablePosition, pv: string[]): string {
  const pos = position.clone();
  const out: string[] = [];
  for (const usi of pv.slice(0, 6)) {
    const move = pos.createMoveByUSI(usi);
    if (!move || !pos.isValidMove(move)) break;
    out.push(formatMove(pos, move));
    pos.doMove(move);
  }
  return out.join(" ") || pv[0] || "";
}
