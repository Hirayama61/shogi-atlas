// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AnalysisRecord } from "../core/analysis";
import {
  fixtureReport,
  fixtureReportWithSummary,
  USI_ANAGUMA_VS_SHIKEN,
  USI_SHIKEN_VS_FUNA,
} from "../core/__tests__/fixtures";
import { parseKifu } from "../core/parse";
import { buildPlayerProfile } from "../core/profile";
import { computePlayerStats } from "../core/stats";
import type { GameRecord } from "../core/types";
import { ShareCard, type ShareCardProps } from "./ShareCard";
import { shareCardSvg, shareFileName } from "./shareImage";
import { digestLines, wrapText } from "./shareText";

const source = { kind: "paste" as const };

async function games(): Promise<GameRecord[]> {
  const a = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
  const b = await parseKifu(USI_ANAGUMA_VS_SHIKEN, { source });
  Object.assign(a, { black: "taro", white: "x1", result: "black", tags: ["taro"] });
  Object.assign(b, { black: "taro", white: "x2", result: "white", tags: ["taro"] });
  return [a, b];
}

function analysis(g: GameRecord): AnalysisRecord {
  return {
    schema: 1,
    id: g.id,
    engine: { name: "fake", depth: 1 },
    analyzedAt: "2026-01-01T00:00:00Z",
    plies: Array.from({ length: g.length + 1 }, (_, ply) => ({ ply, cp: ply >= 15 ? -900 : 0 })),
  };
}

async function props(opts: { analyzed: boolean; report?: string }): Promise<ShareCardProps> {
  const gs = await games();
  const map = new Map(opts.analyzed ? [[gs[0]!.id, analysis(gs[0]!)] as const] : []);
  const profile = buildPlayerProfile(gs, map, "taro", { worstMoves: 0 });
  return {
    stats: computePlayerStats(gs, "taro"),
    profile: profile.games > 0 ? profile : null,
    others: [],
    report: opts.report ?? null,
    date: "2026-10-07",
  };
}

const textOf = () =>
  Array.from(document.querySelectorAll("svg.share-card text"))
    .map((t) => t.textContent)
    .join("\n");

describe("対策 1 枚の画像", () => {
  afterEach(cleanup);

  it("解析とレポートがあれば、カード・レーダー・戦法と囲い・要点が全部入る", async () => {
    const p = await props({ analyzed: true, report: fixtureReportWithSummary("taro", "x") });
    render(<ShareCard {...p} />);
    const text = textOf();
    expect(text).toContain("taro");
    expect(text).toContain("2026-10-07");
    expect(text).toContain("2 局 · 解析済み 1 局");
    expect(text).toContain("勝率 50% (1 勝 1 敗)");
    expect(text).toContain("先手 50% (2 局 1 勝 1 敗)");
    expect(
      document.querySelector('svg.share-card [aria-label*="レーダーチャート"]'),
    ).not.toBeNull();
    expect(text).not.toContain("解析待ち");
    expect(text).toContain("採用戦法");
    expect(text).toContain("囲い");
    for (const name of [...p.stats.openings, ...p.stats.castles].slice(0, 2).map((b) => b.name)) {
      expect(text).toContain(name);
    }
    expect(text).toContain("対策の要点");
    expect(text).toContain("・終盤で崩れる四間飛車党。");
    expect(text).toContain("・こちらが後手: 角交換で乱戦にする。");
    // 要点の節だけ。全文は載せない
    expect(text).not.toContain("一言でいうと");
    // 画像にすると CSS が効かないので、色は CSS 変数でなく実際の値
    const svg = document.querySelector("svg.share-card")!.outerHTML;
    expect(svg).not.toContain("var(--");
  });

  it("解析もレポートも無ければ、その部分が欠けるだけで作れる", async () => {
    const p = await props({ analyzed: false });
    render(<ShareCard {...p} />);
    const text = textOf();
    expect(text).toContain("2 局 · 解析済み 0 局");
    expect(text).toContain("解析待ち");
    expect(document.querySelector('svg.share-card [aria-label*="レーダーチャート"]')).toBeNull();
    expect(text).toContain("採用戦法");
    expect(text).not.toContain("対策の要点");
    expect(text).not.toContain("undefined");
  });

  it("解析ありでレポート無し・解析無しでレポートあり", async () => {
    render(<ShareCard {...await props({ analyzed: true })} />);
    expect(textOf()).not.toContain("対策の要点");
    expect(
      document.querySelector('svg.share-card [aria-label*="レーダーチャート"]'),
    ).not.toBeNull();
    cleanup();
    render(<ShareCard {...await props({ analyzed: false, report: fixtureReport("taro", "x") })} />);
    // 要点の節が無い古いレポートは画面と同じ切り出し (第 1 節と作戦の小見出し)
    expect(textOf()).toContain("対策の要点");
    expect(textOf()).toContain("・四間飛車党。序盤は手堅く、終盤で崩れる。");
    expect(textOf()).toContain("解析待ち");
  });

  it("他の対局者の平均があるときだけ点線とその説明が入る", async () => {
    const p = await props({ analyzed: true });
    render(<ShareCard {...p} />);
    expect(textOf()).not.toContain("点線");
    expect(document.querySelector("svg.share-card .radar-baseline")).toBeNull();
    cleanup();
    render(<ShareCard {...p} others={[p.profile!]} />);
    expect(textOf()).toContain("点線は登録している他の対局者の平均");
    expect(document.querySelector("svg.share-card .radar-baseline")).not.toBeNull();
  });

  it("SVG の文字列は画像として読めるよう xmlns 付きで、HTML を描画しない", async () => {
    const p = await props({
      analyzed: true,
      report: "## 要点\n\n- <b>太字</b> と **強調**\n",
    });
    const svg = shareCardSvg(p);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).not.toContain("<b>");
    expect(svg).toContain("&lt;b&gt;太字&lt;/b&gt; と 強調");
    const height = Number(/height="(\d+)"/.exec(svg)![1]);
    expect(height).toBeGreaterThan(400);
  });

  it("要点は長い行を折り返し、行数に上限がある", () => {
    expect(wrapText("あいうえおかきくけこ", 50, 10)).toEqual(["あいうえお", "かきくけこ"]);
    expect(wrapText("abc", 100, 10)).toEqual(["abc"]);
    const long = Array.from({ length: 30 }, (_, i) => `- 項目 ${i}`).join("\n");
    expect(digestLines(`## 要点\n\n${long}\n`)).toHaveLength(30);
  });

  it("ファイル名に使えない文字を置き換える", () => {
    expect(shareFileName("a/b c", "2026-10-07")).toBe("shogi-atlas-a_b_c-2026-10-07.png");
  });
});
