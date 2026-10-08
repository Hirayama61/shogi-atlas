import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { JUDGEMENT_LABEL } from "../core/analysis";
import {
  PROBLEM_KIND_LABEL,
  buildProblemGroups,
  castleCounts,
  formatLine,
  nextProblem,
  problemChoices,
  type EndgameProblem,
  type ProblemGroup,
  type ProblemRecord,
} from "../core/endgame";
import { SELF_NAME } from "../core/self";
import { db } from "../db/db";
import { Board } from "./Board";
import { readProblemRecords, recordAnswer } from "./endgameRecords";
import { formatDate, SIDE_LABEL } from "./labels";
import { hashFor, navigate, type Route } from "./router";
import { useRestoreView } from "./viewState";

type EndgameRoute = Extract<Route, { kind: "endgame" }>;

/** 問題群の一覧に一度に出す数 */
const PAGE = 30;

function groupTitle(g: ProblemGroup): string {
  return `${PROBLEM_KIND_LABEL[g.kind]} · ${g.castle}`;
}

function groupNote(g: ProblemGroup, records: Record<string, ProblemRecord>): string {
  const parts = [`${g.problems.length} 問`, `${g.games} 局`, g.movers.slice(0, 3).join("・")];
  const fresh = g.problems.filter((p) => !records[p.id]).length;
  const wrong = g.problems.filter((p) => records[p.id] && !records[p.id]!.correct).length;
  if (fresh < g.problems.length) parts.push(`未出題 ${fresh}`);
  if (wrong > 0) parts.push(`不正解 ${wrong}`);
  return parts.join(" · ");
}

function selfNote(g: ProblemGroup): string | null {
  if (g.selfMissed === 0) return null;
  return g.kind === "attack"
    ? `${SELF_NAME}が ${g.selfMissed} 回 崩す手を逃した形`
    : `${SELF_NAME}が ${g.selfMissed} 回 受けを誤って崩された形`;
}

/**
 * 終盤力強化。全棋譜の解析済み局面から作った囲い崩しの問題を、囲いと玉周りの形の問題群ごとに出題する。
 * 状態 (囲い・問題群・出している問題) は URL に持たせ、棋譜ビューアから戻ったときに同じ問題を開き直す。
 */
export function EndgamePage({ route }: { route: EndgameRoute }) {
  const games = useLiveQuery(() => db.games.toArray(), []);
  const analyses = useLiveQuery(() => db.analyses.toArray(), []);
  const groups = useMemo(
    () =>
      games && analyses
        ? buildProblemGroups(games, new Map(analyses.map((a) => [a.id, a] as const)))
        : undefined,
    [games, analyses],
  );
  const [records, setRecords] = useState(readProblemRecords);
  const [shown, setShown] = useState(PAGE);
  useRestoreView(!!groups && !route.group);

  if (!groups) return <p className="muted">読み込み中…</p>;

  const header = (
    <>
      <h2 style={{ fontSize: 16, margin: "4px 0" }}>終盤力強化</h2>
      <p className="muted" style={{ margin: "4px 0" }}>
        全棋譜の解析済みの局面から、囲いを崩す手 (崩し方) と崩されかけた囲いを受ける手 (崩され方)
        を出題する。同じ囲い・同じ玉周りの形の局面は 1 つの問題群にまとまる。
      </p>
    </>
  );

  if (groups.length === 0)
    return (
      <section>
        {header}
        <p className="muted">
          問題にできる局面がありません。エンジン解析の済んだ対局 (中盤以降に囲いへ手が付いたもの)
          が取り込まれると、ここに問題が出ます。
        </p>
      </section>
    );

  const group = route.group ? groups.find((g) => g.key === route.group) : undefined;
  if (group)
    return (
      <Quiz
        group={group}
        route={route}
        records={records}
        onAnswer={(id, correct) => setRecords(recordAnswer(id, correct))}
      />
    );

  const castles = castleCounts(groups);
  const list = route.castle ? groups.filter((g) => g.castle === route.castle) : groups;
  const update = (patch: Partial<EndgameRoute>) => {
    const next: EndgameRoute = { kind: "endgame" };
    const castle = "castle" in patch ? patch.castle : route.castle;
    if (castle) next.castle = castle;
    if (patch.group) next.group = patch.group;
    navigate(next);
  };

  return (
    <section>
      {header}
      <div className="row" style={{ gap: 12, flexWrap: "wrap", margin: "8px 0" }}>
        <label>
          囲い{" "}
          <select
            aria-label="囲い"
            value={route.castle ?? ""}
            onChange={(e) => {
              setShown(PAGE);
              update({ castle: e.target.value || undefined });
            }}
          >
            <option value="">すべて</option>
            {castles.map((c) => (
              <option key={c.castle} value={c.castle}>
                {c.castle} ({c.problems})
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul className="endgame-groups" aria-label="問題群">
        {list.slice(0, shown).map((g) => {
          const self = selfNote(g);
          return (
            <li key={g.key}>
              <button
                type="button"
                className="endgame-group"
                onClick={() => update({ group: g.key })}
              >
                <strong>{groupTitle(g)}</strong>
                <span className="muted"> {groupNote(g, records)}</span>
                {self && <span className="endgame-self">{self}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {list.length > shown && (
        <button type="button" className="ghost" onClick={() => setShown((n) => n + PAGE)}>
          さらに表示 (残り {list.length - shown})
        </button>
      )}
    </section>
  );
}

function Quiz({
  group,
  route,
  records,
  onAnswer,
}: {
  group: ProblemGroup;
  route: EndgameRoute;
  records: Record<string, ProblemRecord>;
  onAnswer: (id: string, correct: boolean) => void;
}) {
  const [current, setCurrent] = useState<string | undefined>(
    () =>
      group.problems.find((p) => p.id === route.problem)?.id ??
      nextProblem(group.problems, records)?.id,
  );
  const [answer, setAnswer] = useState<string | null>(null);
  const problem = group.problems.find((p) => p.id === current) ?? group.problems[0]!;

  // 出している問題を URL に書き戻す (履歴は増やさない)。棋譜ビューアから戻るとこの問題を開き直す
  useEffect(() => {
    const next: EndgameRoute = { kind: "endgame", group: group.key, problem: problem.id };
    if (route.castle) next.castle = route.castle;
    const hash = hashFor(next);
    if (location.hash !== hash) history.replaceState(history.state, "", hash);
  }, [group.key, problem.id, route.castle]);

  const toList = () => {
    const next: EndgameRoute = { kind: "endgame" };
    if (route.castle) next.castle = route.castle;
    navigate(next);
  };
  const choose = (usi: string) => {
    if (answer) return;
    setAnswer(usi);
    onAnswer(problem.id, usi === problem.best);
  };
  const next = () => {
    // 今答えた記録で選び直す (records は答えた後の値)
    setCurrent(nextProblem(group.problems, records, problem.id)?.id);
    setAnswer(null);
  };
  const index = group.problems.indexOf(problem) + 1;

  return (
    <section className="study">
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="ghost" onClick={toList}>
          ← 問題群の一覧
        </button>
      </div>
      <div className="study-title">
        {groupTitle(group)} · {group.problems.length} 問 · {group.games} 局
      </div>
      <div className="study-body">
        <div className="study-board">
          <Board sfen={problem.sfen} flipped={problem.side === "white"} />
        </div>
        <QuizSide problem={problem} answer={answer} onChoose={choose} onNext={next} index={index} />
      </div>
    </section>
  );
}

function QuizSide({
  problem,
  answer,
  onChoose,
  onNext,
  index,
}: {
  problem: EndgameProblem;
  answer: string | null;
  onChoose: (usi: string) => void;
  onNext: () => void;
  index: number;
}) {
  const choices = useMemo(() => problemChoices(problem), [problem]);
  const pv = useMemo(() => formatLine(problem.sfen, problem.pv), [problem]);
  const label = (usi: string) =>
    choices.find((c) => c.usi === usi)?.label ?? formatLine(problem.sfen, [usi])[0] ?? usi;
  const task =
    problem.kind === "attack"
      ? `相手 (${problem.opponent}) の囲いを崩す手は?`
      : `${problem.mover} の囲いを守る受けは?`;
  const correct = answer === problem.best;
  const source = `${formatDate(problem.startedAt).slice(0, 10)} ${problem.mover} vs ${problem.opponent}`;

  return (
    <div className="study-side">
      <div className="muted">
        第 {index} 問 · {SIDE_LABEL[problem.side]}番 ({problem.mover}) · {problem.ply} 手目
      </div>
      <p style={{ margin: "4px 0" }}>{task}</p>
      <div className="candidates" role="group" aria-label="候補手">
        {choices.map((c) => (
          <button
            key={c.usi}
            type="button"
            className={`candidate ${answer ? (c.usi === problem.best ? "good" : c.usi === answer ? "bad" : "") : ""}`}
            aria-pressed={answer === c.usi}
            disabled={!!answer}
            onClick={() => onChoose(c.usi)}
          >
            <strong>{c.label}</strong>
          </button>
        ))}
      </div>
      {answer && (
        <div className="endgame-answer" role="status">
          <p className={correct ? "endgame-correct" : "endgame-wrong"}>
            {correct ? "正解" : "不正解"}
          </p>
          <dl>
            <dt>最善手</dt>
            <dd>{label(problem.best)}</dd>
            <dt>読み筋</dt>
            <dd>{pv.join(" ")}</dd>
            <dt>実戦の手</dt>
            <dd>
              {label(problem.played)}
              {problem.played === problem.best
                ? " (最善手)"
                : ` (損失 ${problem.loss}${JUDGEMENT_LABEL[problem.judgement] ? ` · ${JUDGEMENT_LABEL[problem.judgement]}` : ""})`}
            </dd>
          </dl>
          <div className="row">
            <button type="button" onClick={onNext}>
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
        </div>
      )}
    </div>
  );
}
