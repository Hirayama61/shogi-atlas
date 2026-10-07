import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { BRANCH_KIND_LABEL } from "../core/branches";
import {
  STUDY_CONTINUATION_PLIES,
  buildBranchStudy,
  buildBranchTrees,
  flattenBranchTree,
  type BranchCandidate,
  type BranchNode,
  type BranchTree,
  type StudyStep,
} from "../core/branchStudy";
import type { AnalysisRecord } from "../core/analysis";
import type { GameRecord } from "../core/types";
import { playerSide } from "../core/stats";
import { computeOpeningDetail } from "../core/styles";
import { db } from "../db/db";
import { Board, type BoardMark } from "./Board";
import { describeCandidate, formatDate, judgementTone } from "./labels";
import { GameButtons } from "./GameButtons";
import { hashFor, navigate, type BranchState, type Route } from "./router";
import { canGoBack } from "./viewState";

type Props = { name: string; branchKey: string } & BranchState;

/** 局面キー (手数を除いた SFEN の先頭 3 項目) */
function keyOf(sfen: string): string {
  return sfen.split(" ").slice(0, 3).join(" ");
}

/**
 * 木の中の分岐点 `key` の学習用の手順と、同じ木の節 (局面キー → 節)。見つからなければ null。
 * 続きは、その節の下流で最も深い分岐点を越えるところまで。
 */
function studyAt(
  trees: BranchTree[],
  key: string,
  games: GameRecord[],
  analyses: Map<string, AnalysisRecord>,
  name: string,
) {
  for (const tree of trees) {
    const nodes = flattenBranchTree(tree.roots);
    const node = nodes.find((x) => x.node.key === key)?.node;
    if (!node) continue;
    const deepest = Math.max(...flattenBranchTree([node]).map((x) => x.node.ply));
    const study = buildBranchStudy(
      node,
      games,
      analyses,
      name,
      STUDY_CONTINUATION_PLIES + (deepest - node.ply),
    );
    if (!study) return null;
    const nodeByKey = new Map(nodes.map((x) => [x.node.key, x.node] as const));
    return { node, study, nodeByKey };
  }
  return null;
}

/**
 * 分岐点を学ぶ画面。開始局面から分岐点までの共通手順を 1 手ずつたどり、分岐点で候補手を盤の上で比べ、
 * 選んだ候補手の先をその手を指した対局の手順で進める。分岐点は戦法ごとの木の節で、
 * 手順の途中にある別の分岐点 (祖先・子孫) でもその節の候補手が出て、選ぶとその節から学び直す。
 * 状態 (分岐点・手数・候補・続きの対局) は URL に持たせ、棋譜ビューアから戻ったときに復元する。
 */
export function BranchStudyPage({ name, branchKey, view, at: initialAt, pick, line }: Props) {
  const games = useLiveQuery(() => db.games.toArray(), []);
  const analyses = useLiveQuery(() => db.analyses.toArray(), []);
  const own = useMemo(
    () => (games ?? []).filter((g) => playerSide(g, name) !== null),
    [games, name],
  );
  const byId = useMemo(() => new Map(own.map((g) => [g.id, g] as const)), [own]);
  // 分岐点の木は戦法の詳細と同じ対局集合で作る (URL に戦法が無ければ本人の全対局)
  const subset = useMemo(() => {
    if (!view?.opening) return own;
    const sided = view.side ? own.filter((g) => playerSide(g, name) === view.side) : own;
    const ids = new Set(
      computeOpeningDetail(sided, name, view.quadrant, view.axis ?? "self", view.opening).gameIds,
    );
    return own.filter((g) => ids.has(g.id));
  }, [own, name, view]);
  const map = useMemo(
    () => (analyses ? new Map(analyses.map((a) => [a.id, a] as const)) : undefined),
    [analyses],
  );
  const trees = useMemo(
    () => (games && map ? buildBranchTrees(subset, map, name) : undefined),
    [games, map, subset, name],
  );

  const [rootKey, setRootKey] = useState(branchKey);
  // cursor: 0 = 開始局面、path.length = 分岐点、それより先は選んだ候補手の続き
  const [cursor, setCursor] = useState(initialAt ?? 0);
  const [selected, setSelected] = useState<string | null>(pick ?? null);
  const [lineId, setLineId] = useState<string | null>(line ?? null);

  const data = useMemo(
    () => (trees && map ? studyAt(trees, rootKey, subset, map, name) : undefined),
    [trees, map, rootKey, subset, name],
  );

  const candidate = data?.study.candidates.find((c) => c.usi === selected);
  const studyLine = candidate?.lines.find((l) => l.gameId === lineId) ?? candidate?.lines[0];
  const steps: StudyStep[] = useMemo(
    () => (data ? [...data.study.path, ...(studyLine?.steps ?? [])] : []),
    [data, studyLine],
  );
  const last = steps.length;
  const at = Math.min(cursor, last);
  // 手順の上の分岐点 (手数 → 節)
  const branchAt = useMemo(() => {
    const out = new Map<number, BranchNode>();
    if (!data) return out;
    for (let i = 0; i <= steps.length; i++) {
      const sfen = i === 0 ? data.study.start : steps[i - 1]!.sfen;
      const n = data.nodeByKey.get(keyOf(sfen));
      if (n) out.set(i, n);
    }
    return out;
  }, [data, steps]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setCursor((c) => Math.max(0, c - 1));
      if (e.key === "ArrowRight") setCursor((c) => Math.min(last, c + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last]);

  // 今の状態を URL に書き戻す (履歴は増やさない)。棋譜ビューアから戻るとこの URL で開き直す
  useEffect(() => {
    if (!data) return;
    const route: Route = { kind: "branch", name, key: rootKey, at };
    if (view) route.view = view;
    if (candidate) route.pick = candidate.usi;
    if (studyLine) route.line = studyLine.gameId;
    const hash = hashFor(route);
    if (location.hash !== hash) history.replaceState(history.state, "", hash);
  }, [data, name, rootKey, at, view, candidate, studyLine]);

  const back = () => {
    if (canGoBack()) history.back();
    else navigate(view ? { kind: "player", name, view } : { kind: "player", name });
  };

  if (data === undefined) return <p className="muted">読み込み中…</p>;
  if (data === null)
    return (
      <section>
        <button className="ghost" onClick={back}>
          ← 閉じる
        </button>
        <p className="error">分岐点が見つかりません</p>
      </section>
    );

  const { node, study } = data;
  const rootAt = study.path.length;
  const step = at === 0 ? null : steps[at - 1]!;
  const sfen = step ? step.sfen : study.start;
  // 今の局面が分岐点ならその節、そうでなければこの画面の分岐点の候補を出す
  const here = branchAt.get(at);
  const shown = here ?? node;
  const isRoot = shown.key === node.key;
  // 選んでいる候補: 根では選んだ候補、ほかの分岐点では今の手順で次に指した手
  const pickedHere = isRoot ? (candidate?.usi ?? null) : at < last ? steps[at]!.usi : null;
  const marks: BoardMark[] = here
    ? here.candidates.map((c) => ({
        usi: c.usi,
        tone: judgementTone(c.judgement),
        selected: c.usi === pickedHere,
      }))
    : [];
  const branchStepOf = (n: BranchNode) =>
    Array.from(branchAt).find(([, x]) => x.key === n.key)?.[0];
  const choose = (n: BranchNode, c: BranchCandidate) => {
    if (n.key !== node.key) setRootKey(n.key);
    setSelected(c.usi);
    setLineId(c.gameIds[0] ?? null);
    // 分岐点の手数は開始局面からの手数と同じ (共通手順は対局の先頭から)
    setCursor((n.key === node.key ? rootAt : (branchStepOf(n) ?? n.ply)) + 1);
  };
  const cursors = Array.from(branchAt.keys()).sort((a, b) => a - b);
  const prevBranch = cursors.filter((c) => c < at).pop();
  const nextBranch = cursors.find((c) => c > at);
  // 棋譜ビューアで開く対局と手数。候補手を選んでいればその対局、無ければ共通手順をとった対局
  const viewerGame = studyLine?.gameId ?? study.pathGameId;
  const viewerPly =
    at <= rootAt ? (studyLine ? studyLine.steps[0]!.ply - 1 - (rootAt - at) : at) : step!.ply;
  const gameLabel = (id: string) => {
    const g = byId.get(id);
    if (!g) return id;
    return `${formatDate(g.startedAt).slice(0, 10)} vs ${playerSide(g, name) === "black" ? g.white : g.black}`;
  };
  const who = shown.mover === "self" ? "本人" : "相手";

  let note: string;
  if (here)
    note = isRoot ? `分岐点 · ${who}の候補手` : `次の分岐点 (${here.ply} 手目) · ${who}の候補手`;
  else if (at < rootAt) note = `分岐点まであと ${rootAt - at} 手 · ${who}の候補手`;
  else note = `${candidate?.label ?? ""} の続き`;

  return (
    <section className="study">
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="ghost" onClick={back}>
          ← 閉じる
        </button>
      </div>
      <div className="study-title">
        <span className={`branch-tag ${node.kind}`}>{BRANCH_KIND_LABEL[node.kind]}</span>{" "}
        {node.opening} · {rootAt} 手目まで共通 · {node.gameIds.length} 局 · {name} の {node.wins} 勝
      </div>
      <div className="study-body">
        <div className="study-board">
          <Board
            sfen={sfen}
            lastMoveUsi={step?.usi}
            flipped={study.side === "white"}
            marks={marks}
          />
          <div className="controls" style={{ marginTop: 6 }}>
            <button className="ghost" aria-label="開始局面" onClick={() => setCursor(0)}>
              |◀
            </button>
            <button
              className="ghost"
              aria-label="前の分岐点"
              disabled={prevBranch === undefined}
              onClick={() => prevBranch !== undefined && setCursor(prevBranch)}
            >
              ◆◀
            </button>
            <button
              className="ghost"
              aria-label="戻る"
              disabled={at === 0}
              onClick={() => setCursor(Math.max(0, at - 1))}
            >
              ◀
            </button>
            <span className="study-ply" aria-live="polite">
              {at === 0 ? "開始局面" : `${step!.ply} 手目 ${step!.label}`}
            </span>
            <button
              className="ghost"
              aria-label="進む"
              disabled={at >= last}
              onClick={() => setCursor(Math.min(last, at + 1))}
            >
              ▶
            </button>
            <button
              className="ghost"
              aria-label="次の分岐点"
              disabled={nextBranch === undefined}
              onClick={() => nextBranch !== undefined && setCursor(nextBranch)}
            >
              ▶◆
            </button>
            <button className="ghost" aria-label="分岐点" onClick={() => setCursor(rootAt)}>
              ◆
            </button>
          </div>
        </div>
        <div className="study-side">
          <div className="muted">{note}</div>
          <div className="candidates" role="group" aria-label={`${who}の候補手`}>
            {shown.candidates.map((c) => (
              <button
                key={c.usi}
                type="button"
                className={`candidate ${judgementTone(c.judgement)}`}
                aria-pressed={here ? c.usi === pickedHere : isRoot && c.usi === candidate?.usi}
                onClick={() => choose(shown, c)}
              >
                <strong>{c.label}</strong> ×{c.count}{" "}
                <span className="candidate-note">{describeCandidate(c)}</span>
              </button>
            ))}
          </div>
          {candidate && candidate.lines.length > 1 && (
            <div className="row study-lines">
              <span className="muted">続きの対局:</span>
              {candidate.lines.map((l) => (
                <button
                  key={l.gameId}
                  type="button"
                  className="ghost"
                  aria-pressed={(studyLine?.gameId ?? "") === l.gameId}
                  onClick={() => {
                    setLineId(l.gameId);
                    setCursor(Math.min(cursor, rootAt + l.steps.length));
                  }}
                >
                  {gameLabel(l.gameId)}
                </button>
              ))}
            </div>
          )}
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className="ghost"
              onClick={() =>
                navigate({ kind: "game", id: viewerGame, ply: Math.max(0, viewerPly) })
              }
            >
              棋譜で開く ({gameLabel(viewerGame)} · {Math.max(0, viewerPly)} 手目)
            </button>
          </div>
          <details className="study-games">
            <summary>この分岐点を通った対局 · {node.gameIds.length} 局</summary>
            <GameButtons gameIds={node.gameIds} ply={node.ply} byId={byId} name={name} />
          </details>
        </div>
      </div>
    </section>
  );
}
