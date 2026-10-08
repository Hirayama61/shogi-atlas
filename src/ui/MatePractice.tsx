import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { formatLine, nextProblem, type ProblemRecord } from "../core/endgame";
import {
  buildMateProblems,
  mateFilterCounts,
  type MateProblem,
  type MateSolution,
} from "../core/mateProblems";
import { SELF_NAME } from "../core/self";
import { MAX_MATE_PLY, playMove } from "../core/tsume";
import { db } from "../db/db";
import { MoveBoard } from "./MoveBoard";
import { formatDate, SIDE_LABEL } from "./labels";
import { hashFor, navigate, type Route } from "./router";
import { runTsume } from "./tsumeClient";
import { useRestoreView } from "./viewState";

type EndgameRoute = Extract<Route, { kind: "endgame" }>;

/** 一覧に一度に出す問題の数 */
const PAGE = 30;

function filterRoute(route: EndgameRoute, patch: Partial<EndgameRoute>): EndgameRoute {
  const next: EndgameRoute = { kind: "endgame", mode: "mate" };
  for (const k of ["castle", "mate", "problem"] as const) {
    const v = k in patch ? patch[k] : k === "problem" ? undefined : route[k];
    if (v) next[k] = v;
  }
  return next;
}

function problemNote(p: MateProblem, records: Record<string, ProblemRecord>): string {
  const parts = [`${p.mover} vs ${p.opponent}`, `${p.ply} 手目`, `${p.mateLength} 手詰`, p.castle];
  const r = records[p.id];
  if (r) parts.push(r.correct ? "正解済み" : "不正解");
  return parts.join(" · ");
}

/**
 * 終盤力強化の「詰めろと詰み」。全棋譜の解析済み局面から、短手数の詰みの 2 手前 (詰ます側の手番) を出題する。
 * 詰みの手数と相手の囲いで絞り、記録と出題順は囲い崩しの問題と共通。
 */
export function MatePractice({
  route,
  header,
  records,
  onAnswer,
}: {
  route: EndgameRoute;
  header: ReactNode;
  records: Record<string, ProblemRecord>;
  onAnswer: (id: string, correct: boolean) => void;
}) {
  const games = useLiveQuery(() => db.games.toArray(), []);
  const analyses = useLiveQuery(() => db.analyses.toArray(), []);
  const problems = useMemo(
    () =>
      games && analyses
        ? buildMateProblems(games, new Map(analyses.map((a) => [a.id, a] as const)))
        : undefined,
    [games, analyses],
  );
  const [shown, setShown] = useState(PAGE);
  useRestoreView(!!problems && !route.problem);

  if (!problems) return <p className="muted">読み込み中…</p>;
  const filtered = problems.filter(
    (p) =>
      (!route.castle || p.castle === route.castle) &&
      (!route.mate || String(p.mateLength) === route.mate),
  );
  const problem = route.problem ? problems.find((p) => p.id === route.problem) : undefined;
  if (problem)
    return (
      <MateQuiz
        key={problem.id}
        problem={problem}
        problems={filtered.length > 0 ? filtered : [problem]}
        route={route}
        records={records}
        onAnswer={onAnswer}
      />
    );

  if (problems.length === 0)
    return (
      <section>
        {header}
        <p className="muted">
          問題にできる局面がありません。エンジン解析で {MAX_MATE_PLY}{" "}
          手以内の詰みが見つかった対局が取り込まれると、ここに問題が出ます。
        </p>
      </section>
    );

  const counts = mateFilterCounts(problems);
  const fresh = filtered.filter((p) => !records[p.id]).length;
  const wrong = filtered.filter((p) => records[p.id] && !records[p.id]!.correct).length;
  const first = nextProblem(filtered, records);
  const update = (patch: Partial<EndgameRoute>) => {
    setShown(PAGE);
    navigate(filterRoute(route, patch));
  };

  return (
    <section>
      {header}
      <div className="row" style={{ gap: 12, flexWrap: "wrap", margin: "8px 0" }}>
        <label>
          詰みの手数{" "}
          <select
            aria-label="詰みの手数"
            value={route.mate ?? ""}
            onChange={(e) => update({ mate: e.target.value || undefined })}
          >
            <option value="">すべて</option>
            {counts.lengths.map((c) => (
              <option key={c.length} value={String(c.length)}>
                {c.length} 手詰 ({c.problems})
              </option>
            ))}
          </select>
        </label>
        <label>
          囲い{" "}
          <select
            aria-label="囲い"
            value={route.castle ?? ""}
            onChange={(e) => update({ castle: e.target.value || undefined })}
          >
            <option value="">すべて</option>
            {counts.castles.map((c) => (
              <option key={c.castle} value={c.castle}>
                {c.castle} ({c.problems})
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted" style={{ margin: "4px 0" }}>
        {filtered.length} 問 · 未出題 {fresh}
        {wrong > 0 ? ` · 不正解 ${wrong}` : ""}
      </p>
      {first && (
        <button type="button" onClick={() => navigate(filterRoute(route, { problem: first.id }))}>
          出題する
        </button>
      )}
      <ul className="endgame-groups" aria-label="詰めろの問題">
        {filtered.slice(0, shown).map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className="endgame-group"
              onClick={() => navigate(filterRoute(route, { problem: p.id }))}
            >
              <strong>
                {SIDE_LABEL[p.side]}番 · {p.mateLength} 手詰
              </strong>
              <span className="muted"> {problemNote(p, records)}</span>
              {p.missed && (
                <span className="endgame-self">
                  {p.mover === SELF_NAME ? `${SELF_NAME}が` : `${p.mover} が`}実戦で詰みを逃した
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {filtered.length > shown && (
        <button type="button" className="ghost" onClick={() => setShown((n) => n + PAGE)}>
          さらに表示 (残り {filtered.length - shown})
        </button>
      )}
    </section>
  );
}

type Phase = "solving" | "unsolvable" | "tsumero" | "thinking" | "tsume" | "done";

interface Outcome {
  correct: boolean;
  message: string;
}

const TSUMERO_FAIL: Record<string, string> = {
  check: "王手は詰めろではありません (相手は王手を外せばよい)。",
  none: `詰めろになっていません (相手が何もしなくても ${MAX_MATE_PLY} 手以内に詰みません)。`,
  aborted: "読み切れませんでした。",
  illegal: "指せない手です。",
};

const ATTACK_FAIL: Record<string, string> = {
  "not-check": "王手ではありません。詰将棋は王手の連続で詰ませます。",
  escape: "相手に逃げられました。",
  aborted: "読み切れませんでした。",
  illegal: "指せない手です。",
};

function MateQuiz({
  problem,
  problems,
  route,
  records,
  onAnswer,
}: {
  problem: MateProblem;
  problems: MateProblem[];
  route: EndgameRoute;
  records: Record<string, ProblemRecord>;
  onAnswer: (id: string, correct: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("solving");
  const [solution, setSolution] = useState<MateSolution | null>(null);
  const [sfen, setSfen] = useState(problem.sfen);
  const [line, setLine] = useState<string[]>([]);
  const [remaining, setRemaining] = useState(MAX_MATE_PLY);
  const [note, setNote] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    let alive = true;
    void runTsume("solveMateProblem", problem).then((s) => {
      if (!alive) return;
      setSolution(s);
      setPhase(s ? "tsumero" : "unsolvable");
    });
    return () => {
      alive = false;
    };
  }, [problem]);

  const finish = (correct: boolean, message: string) => {
    setOutcome({ correct, message });
    setPhase("done");
    onAnswer(problem.id, correct);
  };

  const play = async (usi: string) => {
    if (phase === "tsumero") {
      setPhase("thinking");
      setLine([usi]);
      const t = await runTsume("judgeTsumero", sfen, usi);
      if (!t.tsumero) {
        finish(false, TSUMERO_FAIL[t.reason] ?? "");
        return;
      }
      const after = playMove(sfen, usi)!;
      setSfen(after);
      const r = await runTsume(
        "nonDefendingReply",
        after,
        usi === problem.played ? problem.reply : undefined,
      );
      if (!r) {
        finish(true, "詰めろです。相手に詰みを防がない手が無いので、ここで終わります。");
        return;
      }
      setLine([usi, r.reply]);
      setSfen(playMove(after, r.reply)!);
      setRemaining(Math.min(MAX_MATE_PLY, r.mate.length + 2));
      setNote(
        `詰めろです。相手は ${formatLine(problem.sfen, [usi, r.reply])[1] ?? r.reply}。ここから詰ませてください。`,
      );
      setPhase("tsume");
      return;
    }
    if (phase !== "tsume") return;
    setPhase("thinking");
    const played = [...line, usi];
    setLine(played);
    const s = await runTsume("attackStep", sfen, usi, remaining);
    if (s.status === "mated") {
      finish(true, "詰みました。");
      return;
    }
    if (s.status === "failed") {
      finish(false, ATTACK_FAIL[s.reason] ?? "");
      return;
    }
    const after = playMove(playMove(sfen, usi)!, s.reply)!;
    setLine([...played, s.reply]);
    setSfen(after);
    setRemaining(remaining - 2);
    setPhase("tsume");
  };

  // 出している問題を URL に残す (棋譜ビューアから戻るとこの問題を開き直す)
  const toList = () => navigate(filterRoute(route, { problem: undefined }));
  const next = () => {
    const n = nextProblem(problems, records, problem.id);
    if (n && n.id !== problem.id) {
      location.replace(hashFor(filterRoute(route, { problem: n.id })));
      return;
    }
    // ほかに問題が無ければ同じ問題を解き直す
    setSfen(problem.sfen);
    setLine([]);
    setNote(null);
    setOutcome(null);
    setPhase(solution ? "tsumero" : "unsolvable");
  };

  const answer = solution ? [solution.tsumero, solution.reply, ...solution.mate] : [];
  const task =
    phase === "solving"
      ? "読んでいます…"
      : phase === "unsolvable"
        ? `この局面の詰めろを ${MAX_MATE_PLY} 手以内の詰みで読み切れませんでした。次の問題へ進んでください。`
        : line.length === 0
          ? `詰めろをかける手を盤で指してください (相手: ${problem.opponent})。`
          : (note ?? "");
  const source = `${formatDate(problem.startedAt).slice(0, 10)} ${problem.mover} vs ${problem.opponent}`;
  const index = problems.indexOf(problem) + 1;

  return (
    <section className="study">
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="ghost" onClick={toList}>
          ← 問題の一覧
        </button>
      </div>
      <div className="study-title">
        詰めろと詰み · {problem.mateLength} 手詰 · {problem.castle}
      </div>
      <div className="study-body">
        <div className="study-board">
          <MoveBoard
            sfen={sfen}
            flipped={problem.side === "white"}
            lastMoveUsi={line[line.length - 1]}
            disabled={phase !== "tsumero" && phase !== "tsume"}
            onMove={(usi) => void play(usi)}
          />
        </div>
        <div className="study-side">
          <div className="muted">
            {index > 0 ? `第 ${index} 問 · ` : ""}
            {SIDE_LABEL[problem.side]}番 ({problem.mover}) · {problem.ply} 手目
          </div>
          <p style={{ margin: "4px 0" }} aria-live="polite">
            {phase === "thinking" ? "判定しています…" : task}
          </p>
          {line.length > 0 && (
            <p className="muted" style={{ margin: "4px 0" }}>
              指した手順: {formatLine(problem.sfen, line).join(" ")}
            </p>
          )}
          {outcome && (
            <div className="endgame-answer" role="status">
              <p className={outcome.correct ? "endgame-correct" : "endgame-wrong"}>
                {outcome.correct ? "正解" : "不正解"}
              </p>
              <p style={{ margin: "4px 0" }}>{outcome.message}</p>
              <dl>
                <dt>正解の手順</dt>
                <dd>{formatLine(problem.sfen, answer).join(" ")}</dd>
                <dt>実戦</dt>
                <dd>
                  {formatLine(problem.sfen, [problem.played, problem.reply]).join(" ")}
                  {problem.missed ? " (この後、詰みを逃した)" : ""}
                </dd>
              </dl>
            </div>
          )}
          {(outcome || phase === "unsolvable") && (
            <div className="row">
              <button type="button" onClick={next}>
                次の問題
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => navigate({ kind: "game", id: problem.gameId, ply: problem.ply - 1 })}
              >
                棋譜で開く ({source} · {problem.ply - 1} 手目)
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
