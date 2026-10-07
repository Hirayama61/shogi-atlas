import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { JUDGEMENT_LABEL, PHASE_LABEL } from "../core/analysis";
import { buildPlayerProfile } from "../core/profile";
import { findRepeatedLines, straightFrom, trunkOf, type LineNode } from "../core/lines";
import {
  computeOpeningDetail,
  computeStyleQuadrants,
  type OpeningAxis,
  type OpeningDetail,
  type QuadrantStats,
} from "../core/styles";
import { BRANCH_KINDS, reviewBranches, type BranchKind, type BranchReview } from "../core/branches";
import { branchCandidates, type BranchCandidates } from "../core/branchStudy";
import { computeComboStats, type ComboBucket, type ComboStats } from "../core/combo";
import { SELF_NAME } from "../core/self";
import { computePlayerStats, listPlayers, playerSide, type Bucket } from "../core/stats";
import type { GameRecord } from "../core/types";
import { db } from "../db/db";
import { Board } from "./Board";
import { loadCompareTarget, saveCompareTarget } from "./compareTarget";
import { GameButtons } from "./GameButtons";
import {
  describeCandidate,
  judgementTone,
  quadrantQuery,
  SIDE_LABEL,
  STYLE_QUADRANT_LABEL,
  STYLE_QUADRANT_NOTE,
} from "./labels";
import { ProfileCard } from "./ProfileCard";
import { ReportPanel } from "./Report";
import { ShareButton } from "./ShareButton";
import {
  hashFor,
  navigate,
  type ListQuery,
  type PlayerView,
  type Route,
  type SideFilter,
} from "./router";
import { goBackTo, useRestoreView } from "./viewState";

interface Props {
  name: string;
  view?: PlayerView;
}

function pct(wins: number, games: number): string {
  return games ? `${Math.round((wins / games) * 100)}%` : "-";
}

/** 本人の対局のうち何割か (分母は呼び出し側で決める) */
function share(games: number, total: number): string {
  return pct(games, total);
}

function BucketTableLoss({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ name: string; games: number; wins: number; averageLoss: number }>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="panel">
      <strong>{title}</strong>
      <table className="stats">
        <thead>
          <tr>
            <th></th>
            <th>局</th>
            <th>勝</th>
            <th>平均損失</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>{r.games}</td>
              <td>{r.wins}</td>
              <td>{r.averageLoss}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 1 段に最初から出す行数。残りは「他 N 件」に畳む */
const ROW_LIMIT = 10;

/**
 * 戦法・囲いなどの集計表。`routeOf` が返す行は、そのルートへのリンクになる。
 * 割合は `total` に対する局数の割合。`ROW_LIMIT` を超える行は「他 N 件」に畳む。
 */
function BucketRows({
  head = "",
  rows,
  total,
  routeOf,
  selected,
}: {
  head?: string;
  rows: Bucket[];
  total: number;
  routeOf?: (r: Bucket) => Route | undefined;
  selected?: string;
}) {
  const table = (list: Bucket[]) => (
    <table className="stats">
      <thead>
        <tr>
          <th>{head}</th>
          <th>局</th>
          <th>勝</th>
          <th>敗</th>
          <th>勝率</th>
          <th>割合</th>
        </tr>
      </thead>
      <tbody>
        {list.map((r) => {
          const route = routeOf?.(r);
          const classes = [route ? "link" : "", r.name === selected ? "selected" : ""].filter(
            Boolean,
          );
          return (
            <tr
              key={r.name}
              className={classes.length ? classes.join(" ") : undefined}
              aria-current={r.name === selected ? "true" : undefined}
              onClick={route ? () => navigate(route) : undefined}
            >
              <td>{route ? <a href={hashFor(route)}>{r.name}</a> : r.name}</td>
              <td>{r.games}</td>
              <td>{r.wins}</td>
              <td>{r.losses}</td>
              <td className={r.games < FEW_GAMES ? "muted" : undefined}>
                {pct(r.wins, r.wins + r.losses)}
              </td>
              <td>{share(r.games, total)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
  if (rows.length === 0) return null;
  const rest = rows.slice(ROW_LIMIT);
  return (
    <>
      {table(rows.slice(0, ROW_LIMIT))}
      {rest.length > 0 && (
        <details className="rows-more">
          <summary>他 {rest.length} 件</summary>
          {table(rest)}
        </details>
      )}
    </>
  );
}

function BucketTable({ title, rows, total }: { title: string; rows: Bucket[]; total: number }) {
  if (rows.length === 0) return null;
  return (
    <div className="panel">
      <strong>{title}</strong>
      <BucketRows rows={rows} total={total} />
    </div>
  );
}

/** これより局数が少ない行は勝率を薄く出す (母数が小さいので) */
const FEW_GAMES = 3;

interface ComboRow extends Bucket {
  averageLoss?: number | null;
  query?: ListQuery;
}

/**
 * 組み合わせ分析の 1 表。初期は畳んで見出しだけ出す。`query` のある行は絞り込み済みの一覧へのリンク。
 * `highlightLosing` なら負け越している行を目立たせる。
 */
function ComboTable({
  title,
  summary,
  rows,
  showLoss,
  highlightLosing,
}: {
  title: string;
  summary?: string;
  rows: ComboRow[];
  showLoss?: boolean;
  highlightLosing?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <details className="combo">
      <summary>
        {title} <span className="muted">· {summary ?? `${rows.length} 通り`}</span>
      </summary>
      <table className="stats">
        <thead>
          <tr>
            <th></th>
            <th>局</th>
            <th>勝</th>
            <th>敗</th>
            <th>勝率</th>
            {showLoss && <th>平均損失</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const route = r.query ? { kind: "list" as const, query: r.query } : undefined;
            const classes = [
              route ? "link" : "",
              highlightLosing && r.losses > r.wins ? "losing" : "",
            ].filter(Boolean);
            return (
              <tr
                key={r.name}
                className={classes.length ? classes.join(" ") : undefined}
                onClick={route ? () => navigate(route) : undefined}
              >
                <td>{route ? <a href={hashFor(route)}>{r.name}</a> : r.name}</td>
                <td>{r.games}</td>
                <td>{r.wins}</td>
                <td>{r.losses}</td>
                <td className={r.games < FEW_GAMES ? "muted" : undefined}>
                  {pct(r.wins, r.wins + r.losses)}
                </td>
                {showLoss && <td>{r.averageLoss ?? "-"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}

function comboQuery(
  player: string,
  opening: string | undefined,
  castle: string,
  castleSide: SideFilter,
): ListQuery {
  const q: ListQuery = { player, castle, castleSide };
  if (opening) {
    q.opening = opening;
    q.openingSide = "self";
  }
  return q;
}

/** 戦法 × 囲いの組み合わせ分析。表は 4 つで、どれも畳んである */
function ComboAnalysis({ combo, name }: { combo: ComboStats; name: string }) {
  const withQuery = (rows: ComboBucket[], castleSide: SideFilter): ComboRow[] =>
    rows.map((r) => ({ ...r, query: comboQuery(name, r.first, r.second, castleSide) }));
  const losing = combo.vsCastles.filter((r) => r.losses > r.wins).length;
  return (
    <div className="panel">
      <strong>戦法 × 囲い</strong>
      <p className="muted">
        戦法と囲いの組み合わせごとの成績。勝率が薄い行は {FEW_GAMES} 局未満なので局数を見る。
      </p>
      <ComboTable
        title="自分の戦法 × 囲い"
        rows={withQuery(combo.openingCastle, "self")}
        showLoss
      />
      <ComboTable
        title="攻め開始時の囲い"
        summary="最初の駒交換の直前に囲いが完成していたか"
        rows={combo.maturity}
      />
      <ComboTable
        title="自分の戦法 × 相手の囲い"
        rows={withQuery(combo.openingVsCastle, "opponent")}
      />
      <ComboTable
        title="相手の囲い別"
        summary={`${combo.vsCastles.length} 種${losing ? ` · 負け越し ${losing}` : ""}`}
        rows={combo.vsCastles.map((r) => ({
          ...r,
          query: comboQuery(name, undefined, r.name, "opponent"),
        }))}
        highlightLosing
      />
    </div>
  );
}

const BRANCH_KIND_SHORT: Record<BranchKind, string> = {
  mistake: "悪手",
  correct: "正解",
  opponent: "相手",
  unanalyzed: "未解析",
};

/**
 * 分岐点の一覧。1 件 1 行で、悪手を指した分岐 → 正しく指せた分岐 → 相手の選択 → 未解析の順。
 * 行をタップすると分岐点の学習画面へ。
 */
function BranchList({
  reviews,
  candidates,
  name,
}: {
  reviews: BranchReview[];
  candidates: Map<string, BranchCandidates>;
  name: string;
}) {
  const sorted = BRANCH_KINDS.flatMap((k) => reviews.filter((r) => r.kind === k));
  const row = (r: BranchReview) => {
    const c = candidates.get(r.key);
    const route = { kind: "branch" as const, name, key: r.key };
    return (
      <a key={r.key} className={`branch-row ${r.kind}`} href={hashFor(route)}>
        <span className={`branch-tag ${r.kind}`}>{BRANCH_KIND_SHORT[r.kind]}</span>
        <span className="branch-head">
          {r.opening} · {r.ply} 手目 · {r.gameIds.length} 局 {r.wins} 勝
        </span>
        {c && c.candidates.length > 0 && (
          <span className="branch-moves">
            {c.mover === "self" ? "本人" : "相手"}:{" "}
            {c.candidates.map((m, i) => (
              <span key={m.usi} className={`candidate-text ${judgementTone(m.judgement)}`}>
                {i > 0 ? " / " : ""}
                {m.label}
                {m.count > 1 ? ` ×${m.count}` : ""} ({describeCandidate(m)})
              </span>
            ))}
          </span>
        )}
      </a>
    );
  };
  const rest = sorted.slice(ROW_LIMIT);
  return (
    <div className="branch-list">
      {sorted.slice(0, ROW_LIMIT).map(row)}
      {rest.length > 0 && (
        <details className="branch-more">
          <summary>他 {rest.length} 件</summary>
          {rest.map(row)}
        </details>
      )}
    </div>
  );
}

/**
 * 本人が繰り返している手順。分岐の無いところは手を 1 列に並べ (局数は変わったところに出す)、
 * 分かれるところでは分かれた先を局数の多い順に畳んで出す。手をタップすると盤面と対局へのボタンが出る。
 */
function RepeatedLines({
  label,
  root,
  byId,
  name,
  flipped,
}: {
  label: string;
  root: LineNode;
  byId: Map<string, GameRecord>;
  name: string;
  flipped: boolean;
}) {
  const trunk = trunkOf(root);
  const tip = trunk[trunk.length - 1];
  if (!tip) return null;
  return (
    <details className="lines">
      <summary>
        {label} · 幹 {tip.ply} 手目まで {tip.gameIds.length} 局
      </summary>
      <p className="muted">
        2
        局以上が同じ手順をたどった手だけを出す。括弧はそこまで同じ手順だった局数。手をタップすると盤面が出る。
      </p>
      <LineFork nodes={root.children} byId={byId} name={name} flipped={flipped} />
    </details>
  );
}

function LineFork({
  nodes,
  byId,
  name,
  flipped,
}: {
  nodes: LineNode[];
  byId: Map<string, GameRecord>;
  name: string;
  flipped: boolean;
}) {
  if (nodes.length === 1)
    return <LineSegment node={nodes[0]!} byId={byId} name={name} flipped={flipped} />;
  return (
    <div className="line-fork">
      <div className="muted">分岐 · {nodes.length} 通り</div>
      {nodes.map((n) => (
        <details key={n.usi} className="line-branch">
          <summary>
            {n.label} ({n.gameIds.length} 局 · {n.wins} 勝)
          </summary>
          <LineSegment node={n} byId={byId} name={name} flipped={flipped} />
        </details>
      ))}
    </div>
  );
}

function LineSegment({
  node,
  byId,
  name,
  flipped,
}: {
  node: LineNode;
  byId: Map<string, GameRecord>;
  name: string;
  flipped: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const moves = straightFrom(node);
  const last = moves[moves.length - 1]!;
  const current = selected === null ? undefined : moves[selected];
  return (
    <div className="line">
      <div className="line-moves">
        {moves.map((m, i) => {
          const changed = i === 0 || m.gameIds.length !== moves[i - 1]!.gameIds.length;
          return (
            <button
              key={m.ply}
              type="button"
              className="line-move"
              aria-pressed={selected === i}
              title={`${m.ply} 手目 · ${m.gameIds.length} 局`}
              onClick={() => setSelected(selected === i ? null : i)}
            >
              {m.label}
              {changed && <span className="muted"> ({m.gameIds.length})</span>}
            </button>
          );
        })}
      </div>
      {current && (
        <div className="detail-body">
          <div style={{ maxWidth: 260 }}>
            <Board sfen={current.key} flipped={flipped} />
          </div>
          <div>
            <div className="muted">
              {current.ply} 手目 {current.label} · {current.gameIds.length} 局 · {name} の{" "}
              {current.wins} 勝
            </div>
            <GameButtons gameIds={current.gameIds} ply={current.ply} byId={byId} name={name} />
          </div>
        </div>
      )}
      {last.children.length > 0 && (
        <LineFork nodes={last.children} byId={byId} name={name} flipped={flipped} />
      )}
    </div>
  );
}

/** 階層の一つ上へ戻るリンク。直前に見ていた画面なら history.back() で戻り、位置と折りたたみが復元される */
function UpLink({ to, label }: { to: Route; label: string }) {
  const hash = hashFor(to);
  return (
    <a
      className="up-link"
      href={hash}
      onClick={(e) => {
        e.preventDefault();
        goBackTo(hash);
      }}
    >
      ← {label}
    </a>
  );
}

/** 戦型の 4 区分。区分をタップすると、その区分の戦法の一覧を開く (もう一度タップで閉じる) */
function StyleQuadrants({
  quadrants,
  total,
  name,
  view,
}: {
  quadrants: QuadrantStats[];
  total: number;
  name: string;
  view?: PlayerView;
}) {
  return (
    <div className="panel">
      <strong>戦型</strong>
      <p className="muted">
        自分と相手の戦型の組み合わせごとの成績。区分をタップすると、その中の戦法が出る。
      </p>
      <div className="quadrants">
        {quadrants.map((q) => {
          const open = view?.quadrant === q.quadrant;
          const route: Route = open
            ? { kind: "player", name }
            : { kind: "player", name, view: { quadrant: q.quadrant } };
          return (
            <a
              key={q.quadrant}
              className={`quadrant${open ? " selected" : ""}${q.games === 0 ? " empty" : ""}`}
              href={hashFor(route)}
              aria-current={open ? "true" : undefined}
            >
              <span className="quadrant-title">{STYLE_QUADRANT_LABEL[q.quadrant]}</span>
              <span className="muted quadrant-note">{STYLE_QUADRANT_NOTE[q.quadrant]}</span>
              <span className="quadrant-figures">
                {q.games} 局 · 勝率 {pct(q.wins, q.wins + q.losses)} · 割合 {share(q.games, total)}
              </span>
              <span className="muted">
                {q.wins} 勝 {q.losses} 敗 · 先手 {q.bySide.black.games} 局 {q.bySide.black.wins} 勝
                · 後手 {q.bySide.white.games} 局 {q.bySide.white.wins} 勝
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

/** 区分の中の戦法の一覧。自分の戦法と相手の戦法を切り替えられ、行をタップすると戦法の詳細を開く */
function OpeningList({ q, name, view }: { q: QuadrantStats; name: string; view: PlayerView }) {
  const axis = view.axis ?? "self";
  const rows = axis === "self" ? q.openings : q.vsOpenings;
  const axisRoute = (a: OpeningAxis): Route => ({
    kind: "player",
    name,
    view: a === "self" ? { quadrant: q.quadrant } : { quadrant: q.quadrant, axis: a },
  });
  return (
    <div className="panel opening-list">
      <UpLink to={{ kind: "player", name }} label="戦型" />
      <strong>{STYLE_QUADRANT_LABEL[q.quadrant]} の戦法</strong>
      <div className="axis-toggle" role="group" aria-label="戦法の側">
        {(["self", "opponent"] as const).map((a) => (
          <a
            key={a}
            className={`chip${a === axis ? " active" : ""}`}
            href={hashFor(axisRoute(a))}
            aria-pressed={a === axis}
          >
            {a === "self" ? "自分の戦法" : "相手の戦法"}
          </a>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="muted">この区分の対局はありません</p>
      ) : (
        <BucketRows
          head={axis === "self" ? "自分の戦法" : "相手の戦法"}
          rows={rows}
          total={q.games}
          selected={view.opening}
          routeOf={(r) => ({
            kind: "player",
            name,
            view: {
              quadrant: q.quadrant,
              ...(axis === "opponent" ? { axis } : {}),
              opening: r.name,
            },
          })}
        />
      )}
    </div>
  );
}

/** 戦法の詳細の対局を棋譜一覧の絞り込み条件で表す */
function detailQuery(name: string, d: OpeningDetail): ListQuery {
  return {
    ...quadrantQuery(name, d.quadrant),
    opening: d.opening,
    openingSide: d.axis === "self" ? "self" : "opponent",
  };
}

/**
 * 戦法の詳細: 囲い・相手の戦法 (相手の戦法で見ているときは自分の応手) の内訳、繰り返している手順、分岐点、
 * 棋譜一覧へのリンクを 1 か所にまとめる。
 */
function OpeningDetailPanel({
  detail,
  view,
  games,
  byId,
  branches,
  name,
}: {
  detail: OpeningDetail;
  view: PlayerView;
  games: GameRecord[];
  byId: Map<string, GameRecord>;
  branches: { reviews: BranchReview[]; candidates: Map<string, BranchCandidates> } | null;
  name: string;
}) {
  const ids = useMemo(() => new Set(detail.gameIds), [detail]);
  const subset = useMemo(() => games.filter((g) => ids.has(g.id)), [games, ids]);
  const lines = useMemo(
    () =>
      (["black", "white"] as const).flatMap((side) => {
        const root = findRepeatedLines(
          subset.filter((g) => playerSide(g, name) === side),
          name,
        )[0];
        return root ? [{ side, root }] : [];
      }),
    [subset, name],
  );
  // 分岐点は全対局で出したもの (判定を変えない) のうち、通った対局の半分以上がこの戦法のもの
  const reviews = useMemo(
    () =>
      branches?.reviews.filter(
        (r) => r.gameIds.filter((id) => ids.has(id)).length * 2 >= r.gameIds.length,
      ) ?? [],
    [branches, ids],
  );
  const list: Route = { kind: "list", query: detailQuery(name, detail) };
  const parent: Route = {
    kind: "player",
    name,
    view: { quadrant: view.quadrant, ...(view.axis === "opponent" ? { axis: view.axis } : {}) },
  };
  const isSelf = detail.axis === "self";
  return (
    <div className="panel opening-detail">
      <UpLink to={parent} label={`${STYLE_QUADRANT_LABEL[detail.quadrant]} の戦法`} />
      <strong>
        {isSelf ? "" : "相手: "}
        {detail.opening}
      </strong>
      <div className="muted">
        {STYLE_QUADRANT_LABEL[detail.quadrant]} · {detail.games} 局 {detail.wins} 勝 {detail.losses}{" "}
        敗 · 勝率 {pct(detail.wins, detail.wins + detail.losses)}
      </div>
      <p>
        <a className="games-link" href={hashFor(list)}>
          この戦法の棋譜一覧 ({detail.games} 局) →
        </a>
      </p>
      <div className="stats-grid">
        <div>
          <strong>囲い</strong>
          <BucketRows
            head="自分の囲い"
            rows={detail.castles}
            total={detail.games}
            routeOf={(r) => ({
              kind: "list",
              query: { ...detailQuery(name, detail), castle: r.name, castleSide: "self" },
            })}
          />
        </div>
        <div>
          <strong>{isSelf ? "相手の戦法" : "自分の応手"}</strong>
          <BucketRows
            head={isSelf ? "相手の戦法" : "自分の戦法"}
            rows={detail.counter}
            total={detail.games}
          />
        </div>
      </div>
      {lines.map(({ side, root }) => (
        <RepeatedLines
          key={side}
          label={`${SIDE_LABEL[side]}で繰り返している手順`}
          root={root}
          byId={byId}
          name={name}
          flipped={side === "white"}
        />
      ))}
      <div className="detail-branches">
        <strong>分岐点</strong>
        <p className="muted">
          この戦法で 2
          局以上が同じ手順をたどり、そこから分かれた局面。悪手を指した分岐を先に並べる。
          タップすると手順をたどって候補手を比べられる。
        </p>
        {!branches ? (
          <p className="muted">読み込み中…</p>
        ) : reviews.length === 0 ? (
          <p className="muted">まだありません (同じ手順の対局が 2 局以上必要)</p>
        ) : (
          <BranchList reviews={reviews} candidates={branches.candidates} name={name} />
        )}
      </div>
    </div>
  );
}

/**
 * マイページから参考の対局者を 1 人選んで比較の画面を開く。選んだ相手は端末に覚えておく。
 */
function ComparePicker({ name, candidates }: { name: string; candidates: string[] }) {
  const [stored, setStored] = useState(() => loadCompareTarget());
  const target = stored && candidates.includes(stored) ? stored : (candidates[0] ?? "");
  return (
    <div className="panel">
      <strong>参考の対局者と比べる</strong>
      {candidates.length === 0 ? (
        <p className="muted">登録した対局者がいません</p>
      ) : (
        <div className="row" style={{ marginTop: 4 }}>
          <select
            aria-label="比較する相手"
            value={target}
            onChange={(e) => {
              saveCompareTarget(e.target.value);
              setStored(e.target.value);
            }}
          >
            {candidates.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            className="ghost"
            onClick={() => {
              saveCompareTarget(target);
              navigate({ kind: "compare", name, other: target });
            }}
          >
            同じ局面の手を比べる
          </button>
        </div>
      )}
    </div>
  );
}

export function PlayerPage({ name, view }: Props) {
  const games = useLiveQuery(() => db.games.toArray(), []);
  const analyses = useLiveQuery(() => db.analyses.toArray(), []);
  const stats = useMemo(() => (games ? computePlayerStats(games, name) : null), [games, name]);
  const profile = useMemo(() => {
    if (!games || !analyses) return null;
    const map = new Map(analyses.map((a) => [a.id, a] as const));
    const p = buildPlayerProfile(games, map, name, { worstMoves: 8 });
    return p.games > 0 ? p : null;
  }, [games, analyses, name]);
  // レーダーに薄く重ねる比較用。登録している他の対局者のうち解析のある人
  const others = useMemo(() => {
    if (!games || !analyses) return [];
    const map = new Map(analyses.map((a) => [a.id, a] as const));
    return listPlayers(games)
      .filter((p) => p.tracked && p.name !== name)
      .map((p) => buildPlayerProfile(games, map, p.name, { worstMoves: 0 }))
      .filter((p) => p.games > 0);
  }, [games, analyses, name]);
  // 比較の相手の候補。登録している対局者 (自分以外)
  const compareCandidates = useMemo(
    () =>
      listPlayers(games ?? [])
        .filter((p) => p.tracked && p.name !== name)
        .map((p) => p.name),
    [games, name],
  );
  const own = useMemo(
    () =>
      (games ?? [])
        .filter((g) => playerSide(g, name) !== null)
        .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")),
    [games, name],
  );
  const byId = useMemo(() => new Map(own.map((g) => [g.id, g] as const)), [own]);
  const ownIds = useMemo(() => own.map((g) => g.id), [own]);
  // テーブルが無い古い DB や同期前でも undefined になるだけ
  // 無ければ null (読み込み中の undefined と分ける。表示状態の復元は揃ってから)
  const report = useLiveQuery(
    () =>
      db.reports
        .get(name)
        .then((r) => r ?? null)
        .catch(() => null),
    [name],
  );
  const combo = useMemo(() => {
    const map = new Map((analyses ?? []).map((a) => [a.id, a] as const));
    return computeComboStats(own, name, map);
  }, [own, analyses, name]);
  const quadrants = useMemo(() => computeStyleQuadrants(own, name), [own, name]);
  const quadrant = view ? quadrants.find((q) => q.quadrant === view.quadrant) : undefined;
  const detail = useMemo(
    () =>
      view?.opening
        ? computeOpeningDetail(own, name, view.quadrant, view.axis ?? "self", view.opening)
        : null,
    [own, name, view],
  );
  const branches = useMemo(() => {
    if (!stats || !analyses) return null;
    const map = new Map(analyses.map((a) => [a.id, a] as const));
    return {
      reviews: reviewBranches(stats.commonPositions, own, map, name),
      candidates: branchCandidates(stats.commonPositions, own, map, name),
    };
  }, [stats, analyses, own, name]);
  useRestoreView(!!games && !!analyses && report !== undefined);

  if (!games || !stats) return <p className="muted">読み込み中…</p>;
  if (stats.games === 0) return <p className="error">{name} の対局がありません</p>;

  return (
    <section>
      <ProfileCard stats={stats} profile={profile} others={others} />
      <ShareButton
        stats={stats}
        profile={profile}
        others={others}
        report={report?.markdown ?? null}
      />

      {report && <ReportPanel report={report} gameIds={ownIds} />}

      {name === SELF_NAME && <ComparePicker name={name} candidates={compareCandidates} />}

      <StyleQuadrants quadrants={quadrants} total={stats.games} name={name} view={view} />
      {view && quadrant && <OpeningList q={quadrant} name={name} view={view} />}
      {view && detail && detail.games > 0 && (
        <OpeningDetailPanel
          detail={detail}
          view={view}
          games={own}
          byId={byId}
          branches={branches}
          name={name}
        />
      )}

      {profile && (
        <div className="panel">
          <strong>弱点プロファイル</strong>
          <div className="stats-grid">
            <BucketTableLoss title="本人の戦法別の精度" rows={profile.byOpening} />
            <BucketTableLoss title="相手の戦法別の精度" rows={profile.byOpponentOpening} />
          </div>
          <strong>痛かった手</strong>
          {profile.worstMoves.map((w) => (
            <details key={`${w.gameId}-${w.ply}`} className="worst">
              <summary>
                {w.startedAt?.slice(0, 10)} vs {w.opponent} · {w.ply}手目{" "}
                <span className="mark">{JUDGEMENT_LABEL[w.judgement]}</span>{" "}
                <span className="muted">勝率 -{Math.round(w.swing * 100)}%</span>
              </summary>
              <div className="detail-body">
                <div style={{ maxWidth: 220 }}>
                  <Board sfen={w.sfen} flipped={w.side === "white"} />
                </div>
                <div>
                  <div className="muted">
                    {PHASE_LABEL[w.phase]} · 指し手 {w.playedLabel}
                    {w.best ? ` · 最善 ${w.bestLabel ?? w.best}` : ""}
                  </div>
                  <button
                    className="ghost"
                    style={{ marginTop: 6 }}
                    onClick={() => navigate({ kind: "game", id: w.gameId, ply: w.ply - 1 })}
                  >
                    局面を開く
                  </button>
                </div>
              </div>
            </details>
          ))}
        </div>
      )}

      <ComboAnalysis combo={combo} name={name} />

      <BucketTable title="持ち時間別" rows={stats.timeControls} total={stats.games} />
    </section>
  );
}
