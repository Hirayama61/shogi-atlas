import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { JUDGEMENT_LABEL, PHASE_LABEL } from "../core/analysis";
import { buildPlayerProfile } from "../core/profile";
import { findRepeatedLines, straightFrom, trunkOf, type LineNode } from "../core/lines";
import {
  computeOpeningDetail,
  computeStyleQuadrants,
  styleQuadrantOf,
  type CounterBucket,
  type OpeningAxis,
  type OpeningDetail,
  type QuadrantStats,
} from "../core/styles";
import type { BranchKind } from "../core/branches";
import {
  buildBranchTrees,
  flattenBranchTree,
  type BranchNode,
  type BranchTree,
} from "../core/branchStudy";
import type { AnalysisRecord } from "../core/analysis";
import { computeComboStats } from "../core/combo";
import { SELF_NAME } from "../core/self";
import {
  computePlayerStats,
  listPlayers,
  playerSide,
  type Bucket,
  type PlayerStats,
} from "../core/stats";
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
import { hashFor, navigate, type ListQuery, type PlayerView, type Route } from "./router";
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

/** 1 段に最初から出す行数。残りは「他 N 件」に畳む */
const ROW_LIMIT = 10;

/**
 * 戦法・囲いなどの集計表。`routeOf` が返す行は、そのルートへのリンクになる。
 * 割合は `total` に対する局数の割合。`ROW_LIMIT` を超える行は「他 N 件」に畳む。
 * `lossOf` を渡すと平均損失の列を足し、`highlightLosing` なら負け越している行を目立たせる。
 */
function BucketRows<B extends Bucket>({
  head = "",
  rows,
  total,
  routeOf,
  selected,
  lossOf,
  highlightLosing,
}: {
  head?: string;
  rows: B[];
  total: number;
  routeOf?: (r: B) => Route | undefined;
  selected?: string;
  lossOf?: (r: B) => number | null | undefined;
  highlightLosing?: boolean;
}) {
  const table = (list: B[]) => (
    <table className="stats">
      <thead>
        <tr>
          <th>{head}</th>
          <th>局</th>
          <th>勝</th>
          <th>敗</th>
          <th>勝率</th>
          <th>割合</th>
          {lossOf && <th>平均損失</th>}
        </tr>
      </thead>
      <tbody>
        {list.map((r) => {
          const route = routeOf?.(r);
          const classes = [
            route ? "link" : "",
            r.name === selected ? "selected" : "",
            highlightLosing && r.losses > r.wins ? "losing" : "",
          ].filter(Boolean);
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
              {lossOf && <td>{lossOf(r) ?? "-"}</td>}
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

const BRANCH_KIND_SHORT: Record<BranchKind, string> = {
  mistake: "悪手",
  correct: "正解",
  opponent: "相手",
  unanalyzed: "未解析",
};

/**
 * 分岐点の木。1 節 1 行で、下流の分岐点は親の下に字下げして「親で指した手の先」と添える。
 * 悪手を含む枝を先に並べる。行をタップすると分岐点の学習画面へ。
 * 行数が上限を超えたら、根の単位で残りを「他 N 件」に畳む (木を途中で切らない)。
 */
function BranchTreeList({
  trees,
  name,
  view,
}: {
  trees: BranchTree[];
  name: string;
  view: PlayerView;
}) {
  const row = ({ node: n, depth }: { node: BranchNode; depth: number }) => {
    const route = { kind: "branch" as const, name, key: n.key, view };
    return (
      <a
        key={n.key}
        className={`branch-row ${n.kind}`}
        href={hashFor(route)}
        data-depth={depth}
        style={{ paddingLeft: depth * 16 }}
      >
        {n.via && <span className="branch-via">└ {n.via.label} の先</span>}
        <span className={`branch-tag ${n.kind}`}>{BRANCH_KIND_SHORT[n.kind]}</span>
        <span className="branch-head">
          {n.opening} · {n.ply} 手目 · {n.gameIds.length} 局 {n.wins} 勝
        </span>
        {n.candidates.length > 0 && (
          <span className="branch-moves">
            {n.mover === "self" ? "本人" : "相手"}:{" "}
            {n.candidates.map((m, i) => (
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
  const shown: Array<{ node: BranchNode; depth: number }> = [];
  const rest: Array<{ node: BranchNode; depth: number }> = [];
  for (const tree of trees) {
    for (const root of tree.roots) {
      const rows = flattenBranchTree([root]);
      (shown.length < ROW_LIMIT ? shown : rest).push(...rows);
    }
  }
  const sides = trees.length > 1;
  return (
    <div className="branch-list">
      {trees.map((tree) => {
        const keys = new Set(flattenBranchTree(tree.roots).map((x) => x.node.key));
        const mine = shown.filter((x) => keys.has(x.node.key));
        if (mine.length === 0) return null;
        return (
          <div key={tree.side} className="branch-tree">
            {sides && <div className="muted">{SIDE_LABEL[tree.side]}</div>}
            {mine.map(row)}
          </div>
        );
      })}
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

/**
 * 区分の中の戦法の一覧。自分の戦法と相手の戦法を切り替えられ、行をタップすると戦法の詳細を開く。
 * 下に区分の中での相手の囲い別の成績を添える。
 */
function OpeningList({
  q,
  name,
  view,
  vsCastles,
}: {
  q: QuadrantStats;
  name: string;
  view: PlayerView;
  vsCastles: Bucket[];
}) {
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
      {vsCastles.length > 0 && (
        <div className="quadrant-castles">
          <strong>相手の囲い</strong>
          <p className="muted">
            この区分で当たった相手の囲いごとの成績。負け越している囲いは赤く出る。
          </p>
          <BucketRows
            head="相手の囲い"
            rows={vsCastles}
            total={q.games}
            highlightLosing
            routeOf={(r) => ({
              kind: "list",
              query: { ...quadrantQuery(name, q.quadrant), castle: r.name, castleSide: "opponent" },
            })}
          />
        </div>
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

/** 戦法の詳細の「相手の戦法 / 自分の応手」の 1 行 (本人の戦法 × 相手の戦法、応手は囲いも) の対局 */
function counterQuery(name: string, d: OpeningDetail, r: CounterBucket): ListQuery {
  const isSelf = d.axis === "self";
  return {
    ...quadrantQuery(name, d.quadrant),
    opening: isSelf ? d.opening : r.opening,
    openingSide: "self",
    vsOpening: isSelf ? r.opening : d.opening,
    ...(r.castle ? { castle: r.castle, castleSide: "self" as const } : {}),
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
  analyses,
  name,
}: {
  detail: OpeningDetail;
  view: PlayerView;
  games: GameRecord[];
  byId: Map<string, GameRecord>;
  analyses: Map<string, AnalysisRecord> | null;
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
  // 分岐点はこの戦法の対局だけで求め、節どうしの包含関係で木にする
  const trees = useMemo(
    () => (analyses ? buildBranchTrees(subset, analyses, name) : null),
    [subset, analyses, name],
  );
  // 平均損失・攻め開始時の囲い・相手の囲いはこの戦法の対局だけで集計する
  const combo = useMemo(
    () => computeComboStats(subset, name, analyses ?? new Map()),
    [subset, analyses, name],
  );
  const castleLoss = useMemo(
    () => new Map(combo.castles.map((c) => [c.name, c.averageLoss] as const)),
    [combo],
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
        {combo.averageLoss !== null &&
          ` · 平均損失 ${combo.averageLoss} (解析済み ${combo.analyzed} 局)`}
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
            lossOf={combo.analyzed ? (r) => castleLoss.get(r.name) : undefined}
            routeOf={(r) => ({
              kind: "list",
              query: { ...detailQuery(name, detail), castle: r.name, castleSide: "self" },
            })}
          />
        </div>
        <div>
          <strong>{isSelf ? "相手の戦法" : "自分の応手"}</strong>
          <BucketRows
            head={isSelf ? "相手の戦法" : "自分の戦法 · 囲い"}
            rows={detail.counter}
            total={detail.games}
            routeOf={(r) => ({ kind: "list", query: counterQuery(name, detail, r) })}
          />
        </div>
        <div>
          <strong>攻め開始時の囲い</strong>
          <p className="muted">最初の駒交換の直前に自分の囲いが完成していたか</p>
          <BucketRows head="成熟度" rows={combo.maturity} total={detail.games} />
        </div>
        <div>
          <strong>相手の囲い</strong>
          <BucketRows
            head="相手の囲い"
            rows={combo.vsCastles}
            total={detail.games}
            highlightLosing
            routeOf={(r) => ({
              kind: "list",
              query: { ...detailQuery(name, detail), castle: r.name, castleSide: "opponent" },
            })}
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
          局以上が同じ手順をたどり、そこから分かれた局面。字下げした行は、上の分岐点でその手を指した先にある分岐点。
          悪手を含む枝を先に並べる。タップすると手順をたどって候補手を比べられる。
        </p>
        {!trees ? (
          <p className="muted">読み込み中…</p>
        ) : trees.length === 0 ? (
          <p className="muted">まだありません (同じ手順の対局が 2 局以上必要)</p>
        ) : (
          <BranchTreeList trees={trees} name={name} view={view} />
        )}
      </div>
    </div>
  );
}

/**
 * 本人の全対局に対する割合: 自分の戦法の採用率、相手の戦法の遭遇率、自分の囲いの分布。
 * 区分をまたいで「よく当たるのに勝てない戦法」を比べるための表で、どれも分母は全対局数。
 */
function OverallShares({ stats, name }: { stats: PlayerStats; name: string }) {
  const tables: Array<{
    title: string;
    head: string;
    rows: Bucket[];
    query: (r: Bucket) => ListQuery;
  }> = [
    {
      title: "採用率",
      head: "自分の戦法",
      rows: stats.openings,
      query: (r) => ({ player: name, opening: r.name, openingSide: "self" }),
    },
    {
      title: "遭遇率",
      head: "相手の戦法",
      rows: stats.vsOpenings,
      query: (r) => ({ player: name, opening: r.name, openingSide: "opponent" }),
    },
    {
      title: "囲いの分布",
      head: "自分の囲い",
      rows: stats.castles,
      query: (r) => ({ player: name, castle: r.name, castleSide: "self" }),
    },
  ];
  return (
    <div className="panel overall-shares">
      <strong>全対局での割合</strong>
      <p className="muted">
        戦型の区分をまたいだ {stats.games} 局全体に対する割合。勝率が薄い行は {FEW_GAMES}{" "}
        局未満なので局数を見る。
      </p>
      {tables.map((t) => (
        <details key={t.title} className="combo">
          <summary>
            {t.title} <span className="muted">· {t.rows.length} 種</span>
          </summary>
          <BucketRows
            head={t.head}
            rows={t.rows}
            total={stats.games}
            routeOf={(r) => ({ kind: "list", query: t.query(r) })}
          />
        </details>
      ))}
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
  const quadrants = useMemo(() => computeStyleQuadrants(own, name), [own, name]);
  const quadrant = view ? quadrants.find((q) => q.quadrant === view.quadrant) : undefined;
  const quadrantCastles = useMemo(
    () =>
      view
        ? computeComboStats(
            own.filter((g) => styleQuadrantOf(g, name) === view.quadrant),
            name,
          ).vsCastles
        : [],
    [own, name, view],
  );
  const detail = useMemo(
    () =>
      view?.opening
        ? computeOpeningDetail(own, name, view.quadrant, view.axis ?? "self", view.opening)
        : null,
    [own, name, view],
  );
  const analysisMap = useMemo(
    () => (analyses ? new Map(analyses.map((a) => [a.id, a] as const)) : null),
    [analyses],
  );
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
      {view && quadrant && (
        <OpeningList q={quadrant} name={name} view={view} vsCastles={quadrantCastles} />
      )}
      {view && detail && detail.games > 0 && (
        <OpeningDetailPanel
          detail={detail}
          view={view}
          games={own}
          byId={byId}
          analyses={analysisMap}
          name={name}
        />
      )}

      {profile && (
        <div className="panel">
          <strong>弱点プロファイル</strong>
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

      <OverallShares stats={stats} name={name} />

      <BucketTable title="持ち時間別" rows={stats.timeControls} total={stats.games} />
    </section>
  );
}
