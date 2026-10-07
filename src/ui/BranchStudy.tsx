import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { BRANCH_KIND_LABEL, reviewBranches } from "../core/branches";
import { buildBranchStudy, type StudyCandidate, type StudyStep } from "../core/branchStudy";
import { findCommonPositions, playerSide } from "../core/stats";
import { db } from "../db/db";
import { Board, type BoardMark } from "./Board";
import { describeCandidate, formatDate, judgementTone } from "./labels";
import { GameButtons } from "./GameButtons";
import { navigate } from "./router";
import { canGoBack } from "./viewState";

interface Props {
  name: string;
  /** 分岐点の局面キー */
  branchKey: string;
}

/**
 * 分岐点を学ぶ画面。開始局面から分岐点までの共通手順を 1 手ずつたどり、分岐点で候補手を盤の上で比べ、
 * 選んだ候補手の先をその手を指した対局の手順で進める。
 */
export function BranchStudyPage({ name, branchKey }: Props) {
  const games = useLiveQuery(() => db.games.toArray(), []);
  const analyses = useLiveQuery(() => db.analyses.toArray(), []);
  const own = useMemo(
    () => (games ?? []).filter((g) => playerSide(g, name) !== null),
    [games, name],
  );
  const byId = useMemo(() => new Map(own.map((g) => [g.id, g] as const)), [own]);
  const data = useMemo(() => {
    if (!games || !analyses) return undefined;
    const p = findCommonPositions(own, name).find((x) => x.key === branchKey);
    if (!p) return null;
    const map = new Map(analyses.map((a) => [a.id, a] as const));
    const study = buildBranchStudy(p, own, map, name);
    const review = reviewBranches([p], own, map, name)[0];
    return study && review ? { p, study, review } : null;
  }, [games, analyses, own, name, branchKey]);

  // cursor: 0 = 開始局面、path.length = 分岐点、それより先は選んだ候補手の続き
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [lineIndex, setLineIndex] = useState(0);

  const candidate: StudyCandidate | undefined =
    selected === null ? undefined : data?.study.candidates[selected];
  const line = candidate?.lines[lineIndex] ?? candidate?.lines[0];
  const steps: StudyStep[] = useMemo(
    () => (data ? [...data.study.path, ...(line?.steps ?? [])] : []),
    [data, line],
  );
  const last = steps.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setCursor((c) => Math.max(0, c - 1));
      if (e.key === "ArrowRight") setCursor((c) => Math.min(last, c + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last]);

  const back = () => {
    if (canGoBack()) history.back();
    else navigate({ kind: "player", name });
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

  const { p, study, review } = data;
  const branchAt = study.path.length;
  const at = Math.min(cursor, last);
  const step = at === 0 ? null : steps[at - 1]!;
  const sfen = step ? step.sfen : study.start;
  const atBranch = at === branchAt;
  const marks: BoardMark[] = atBranch
    ? study.candidates.map((c, i) => ({
        usi: c.usi,
        tone: judgementTone(c.judgement),
        selected: i === selected,
      }))
    : [];
  const select = (i: number) => {
    setSelected(i);
    setLineIndex(0);
    setCursor(branchAt + 1);
  };
  // 棋譜ビューアで開く対局と手数。候補手を選んでいればその対局、無ければ共通手順をとった対局
  const viewerGame = line?.gameId ?? study.pathGameId;
  const viewerPly =
    at <= branchAt ? (line ? line.steps[0]!.ply - 1 - (branchAt - at) : at) : step!.ply;
  const gameLabel = (id: string) => {
    const g = byId.get(id);
    if (!g) return id;
    return `${formatDate(g.startedAt).slice(0, 10)} vs ${playerSide(g, name) === "black" ? g.white : g.black}`;
  };
  const who = study.mover === "self" ? "本人" : "相手";

  return (
    <section className="study">
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="ghost" onClick={back}>
          ← 閉じる
        </button>
      </div>
      <div className="study-title">
        <span className={`branch-tag ${review.kind}`}>{BRANCH_KIND_LABEL[review.kind]}</span>{" "}
        {review.opening} · {branchAt} 手目まで共通 · {p.gameIds.length} 局 · {name} の {p.wins} 勝
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
            <button className="ghost" aria-label="分岐点" onClick={() => setCursor(branchAt)}>
              ◆
            </button>
          </div>
        </div>
        <div className="study-side">
          <div className="muted">
            {atBranch
              ? `分岐点 · ${who}の候補手`
              : at < branchAt
                ? `分岐点まであと ${branchAt - at} 手 · ${who}の候補手`
                : `${candidate?.label ?? ""} の続き`}
          </div>
          <div className="candidates" role="group" aria-label={`${who}の候補手`}>
            {study.candidates.map((c, i) => (
              <button
                key={c.usi}
                type="button"
                className={`candidate ${judgementTone(c.judgement)}`}
                aria-pressed={selected === i}
                onClick={() => select(i)}
              >
                <strong>{c.label}</strong> ×{c.count}{" "}
                <span className="candidate-note">{describeCandidate(c)}</span>
              </button>
            ))}
          </div>
          {candidate && candidate.lines.length > 1 && (
            <div className="row study-lines">
              <span className="muted">続きの対局:</span>
              {candidate.lines.map((l, i) => (
                <button
                  key={l.gameId}
                  type="button"
                  className="ghost"
                  aria-pressed={(line?.gameId ?? "") === l.gameId}
                  onClick={() => {
                    setLineIndex(i);
                    setCursor(Math.min(cursor, branchAt + l.steps.length));
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
            <summary>この分岐点を通った対局 · {p.gameIds.length} 局</summary>
            <GameButtons gameIds={p.gameIds} ply={p.ply} byId={byId} name={name} />
          </details>
        </div>
      </div>
    </section>
  );
}
