import { useState } from "react";
import type { PlayerProfile, RateBreakdown, RateEvidence } from "../core/profile";
import { averageAxes, RADAR_LOSS_FLOOR, radarAxes, type RadarAxis } from "../core/radar";
import type { PlayerStats } from "../core/stats";
import { Board } from "./Board";
import { LossHelp } from "./LossHelp";
import { pageTitle, shownRank } from "./labels";
import { RadarChart } from "./RadarChart";
import { hashFor, navigate } from "./router";

type RateKind = keyof RateBreakdown;

const RATES: Record<
  RateKind,
  {
    label: string;
    /** 内訳の説明 (どの局面を指しているか) */
    note: string;
    hit: string;
    miss: string;
  }
> = {
  conversion: {
    label: "有利 (+300) からの勝率",
    note: "評価値が初めて +300 以上になった局面",
    hit: "勝った",
    miss: "勝てなかった",
  },
  resilience: {
    label: "不利 (-300) から負けなかった率",
    note: "評価値が初めて -300 以下になった局面",
    hit: "負けなかった",
    miss: "負けた",
  },
  punish: {
    label: "相手の大悪手を咎めた率",
    note: "相手が大悪手 (対局で最も勝率を落とした手) を指した後の局面。最善は本人が指すべきだった手",
    hit: "咎めて勝った",
    miss: "勝てなかった",
  },
  firstBlunder: {
    label: "先に大悪手を指す率",
    note: "対局で最初の大悪手を指す前の局面",
    hit: "自分が先",
    miss: "相手が先",
  },
};

const isRate = (key: RadarAxis["key"]): key is RateKind => key in RATES;

function pct(wins: number, games: number): string {
  return games ? `${Math.round((wins / games) * 100)}%` : "-";
}

interface Props {
  stats: PlayerStats;
  /** 解析済みの対局が無ければ null */
  profile: PlayerProfile | null;
  /** 比較用の他の対局者のプロファイル */
  others: PlayerProfile[];
}

/**
 * 対局者ページ先頭のプロフィールカード。局数・解析済み・勝率・先後と、傾向のレーダーチャート。
 * 局数のタイルはその人で絞った棋譜一覧 (全対局) へのリンク。
 * 率の軸はタップすると内訳 (数えた対局と根拠の局面) が下に開く。
 */
export function ProfileCard({ stats, profile, others }: Props) {
  const [open, setOpen] = useState<RateKind | null>(null);
  const axes = profile ? radarAxes(profile) : null;
  const baseline = others.length ? averageAxes(others.map(radarAxes)) : undefined;
  const side = (s: "black" | "white") => stats.bySide[s];
  const decided = stats.wins + stats.losses;
  const rank = shownRank(stats.name, stats.rank);
  return (
    <div className="panel profile-card">
      <div className="game-title" style={{ fontSize: 18 }}>
        {pageTitle(stats.name)}
        {rank ? <span className="muted"> {rank}</span> : null}
      </div>
      <div className="figures">
        <a
          className="figure-link"
          href={hashFor({ kind: "list", query: { player: stats.name } })}
          title="この人の対局をすべて棋譜一覧で開く"
        >
          <strong>
            {profile?.games ?? 0}/{stats.games} 局
          </strong>
          <span>解析済み{profile ? ` · 平均損失 ${profile.averageLoss}` : ""} · 一覧 ›</span>
        </a>
        <div>
          <strong>{pct(stats.wins, decided)}</strong>
          <span>
            勝率 · {stats.wins} 勝 {stats.losses} 敗{stats.draws ? ` ${stats.draws} 分` : ""}
          </span>
        </div>
        {(["black", "white"] as const).map((s) => (
          <div key={s}>
            <strong>{pct(side(s).wins, side(s).wins + side(s).losses)}</strong>
            <span>
              {s === "black" ? "先手" : "後手"} {side(s).games} 局 · {side(s).wins} 勝{" "}
              {side(s).losses} 敗
            </span>
          </div>
        ))}
      </div>
      {!axes && (
        <p className="muted">
          解析待ち:
          エンジン解析の済んだ対局がまだありません。解析が入るとここに傾向のレーダーチャートが出ます。
        </p>
      )}
      {axes && (
        <>
          <div className="radar-wrap">
            <RadarChart axes={axes} baseline={baseline} />
            <ul className="radar-axes">
              {axes.map((a) => {
                const body = (
                  <>
                    <span>{a.label}</span>
                    <strong>{a.score ?? "-"}</strong>
                    <span className="muted">{a.raw}</span>
                  </>
                );
                if (!isRate(a.key)) return <li key={a.key}>{body}</li>;
                const kind = a.key;
                return (
                  <li key={a.key}>
                    <button
                      type="button"
                      className={open === kind ? "active" : undefined}
                      aria-expanded={open === kind}
                      onClick={() => setOpen(open === kind ? null : kind)}
                    >
                      {body}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          {open && profile && <RateBreakdownList kind={open} list={profile.rates[open]} />}
          <RadarHelp hasBaseline={!!baseline} />
          <LossHelp />
        </>
      )}
    </div>
  );
}

function RadarHelp({ hasBaseline }: { hasBaseline: boolean }) {
  return (
    <details className="help">
      <summary>レーダーの見方</summary>
      <p>どの軸も 0〜100 で、外側ほど良い。点が無い軸はまだ該当する局面が無い。</p>
      <p>
        序盤・中盤・終盤: その段階の 1 手あたり平均損失を、損失 0 で 100、{RADAR_LOSS_FLOOR} 以上で
        0 になるように直線で換算。
      </p>
      <p>
        有利を活かす: 評価値が初めて +300 以上になった対局のうち勝った割合。粘り: 初めて -300
        以下になった対局のうち負けなかった割合。咎める: 相手が大悪手を指した対局のうち勝った割合。
        先に崩れない:
        大悪手が出た対局のうち、先に指したのが相手だった割合。率の行をタップすると、数えた対局が開く。
      </p>
      {hasBaseline && <p>点線は登録している他の対局者の平均。</p>}
    </details>
  );
}

function RateBreakdownList({ kind, list }: { kind: RateKind; list: RateEvidence[] }) {
  const current = RATES[kind];
  return (
    <div className="rate-breakdown">
      <div className="muted">
        {current.label} の内訳 · {list.length} 局 · {current.note}
      </div>
      {list.length === 0 && <p className="muted">該当する対局はまだありません</p>}
      {list.map((e) => (
        <RateRow key={`${e.gameId}-${e.ply}`} e={e} label={e.hit ? current.hit : current.miss} />
      ))}
    </div>
  );
}

/** 内訳の 1 行。開いたときだけ盤面を出す */
function RateRow({ e, label }: { e: RateEvidence; label: string }) {
  const [shown, setShown] = useState(false);
  const signed = (cp: number) => (cp > 0 ? `+${cp}` : `${cp}`);
  return (
    <details className="rate-row" onToggle={(ev) => setShown(ev.currentTarget.open)}>
      <summary>
        {e.startedAt?.slice(0, 10)} vs {e.opponent} · {e.ply}手目{" "}
        <span className={e.hit ? "hit" : "mark"}>{label}</span>{" "}
        <span className="muted">{signed(e.cp)}</span>
      </summary>
      {shown && (
        <div className="detail-body">
          <div style={{ maxWidth: 220 }}>
            <Board sfen={e.sfen} flipped={e.side === "white"} />
          </div>
          <div>
            {e.played && (
              <div className="muted">
                {e.by === e.side ? "自分" : "相手"}の大悪手 {e.playedLabel ?? e.played}
                {e.best ? ` · 最善 ${e.bestLabel ?? e.best}` : ""}
              </div>
            )}
            <button
              className="ghost"
              style={{ marginTop: 6 }}
              onClick={() => navigate({ kind: "game", id: e.gameId, ply: e.ply })}
            >
              局面を開く
            </button>
          </div>
        </div>
      )}
    </details>
  );
}
