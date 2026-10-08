// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AnalysisRecord } from "../core/analysis";
import { USI_ANAGUMA_VS_SHIKEN, USI_SHIKEN_VS_FUNA } from "../core/__tests__/fixtures";
import { parseKifu } from "../core/parse";
import { buildPlayerProfile, type PlayerProfile } from "../core/profile";
import { hasBaselineLine, type RadarAxis } from "../core/radar";
import { computePlayerStats } from "../core/stats";
import { ProfileCard } from "./ProfileCard";
import { RadarChart } from "./RadarChart";

const AXES: RadarAxis[] = (
  [
    ["opening", "序盤"],
    ["middlegame", "中盤"],
    ["endgame", "終盤"],
    ["conversion", "有利を活かす"],
    ["resilience", "粘り"],
    ["punish", "咎める"],
    ["firstBlunder", "先に崩れない"],
  ] as const
).map(([key, label]) => ({ key, label, score: 50, raw: "" }));

const BASE = {
  opening: 60,
  middlegame: 60,
  endgame: 60,
  conversion: null,
  resilience: 60,
  punish: 60,
  firstBlunder: 60,
};

const baselinePath = () => document.querySelector("svg.radar .radar-baseline");
// "M x,y L x,y" を 1 辺として数える
const edges = (d: string) => d.split("M").filter((s) => s.trim()).length;

describe("レーダーの平均の点線", () => {
  afterEach(cleanup);

  it("平均の 1 軸が欠けていても、残りの軸の辺に点線が描かれる", () => {
    render(<RadarChart axes={AXES} baseline={BASE} />);
    const path = baselinePath();
    expect(path).not.toBeNull();
    expect(path!.getAttribute("stroke-dasharray")).toBe("4 3");
    // 7 辺のうち欠けた軸に接する 2 辺だけ途切れる
    expect(edges(path!.getAttribute("d")!)).toBe(5);
  });

  it("平均が揃っていれば一周 (7 辺) 描かれる", () => {
    render(<RadarChart axes={AXES} baseline={{ ...BASE, conversion: 60 }} />);
    expect(edges(baselinePath()!.getAttribute("d")!)).toBe(7);
  });

  it("平均が無い、または隣り合う 2 軸が揃わなければ点線を描かない", () => {
    render(<RadarChart axes={AXES} />);
    expect(baselinePath()).toBeNull();
    cleanup();
    const sparse = { opening: 60, endgame: 60 };
    render(<RadarChart axes={AXES} baseline={sparse} />);
    expect(baselinePath()).toBeNull();
    expect(hasBaselineLine(AXES, sparse)).toBe(false);
    expect(hasBaselineLine(AXES, undefined)).toBe(false);
    expect(hasBaselineLine(AXES, BASE)).toBe(true);
  });
});

describe("プロフィールカードの点線の説明", () => {
  afterEach(cleanup);

  async function setup() {
    const source = { kind: "paste" as const };
    const a = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
    const b = await parseKifu(USI_ANAGUMA_VS_SHIKEN, { source });
    Object.assign(a, { black: "taro", white: "x1", result: "black", tags: ["taro"] });
    Object.assign(b, { black: "taro", white: "x2", result: "white", tags: ["taro"] });
    const analysis: AnalysisRecord = {
      schema: 1,
      id: a.id,
      engine: { name: "fake", depth: 1 },
      analyzedAt: "2026-01-01T00:00:00Z",
      plies: Array.from({ length: a.length + 1 }, (_, ply) => ({ ply, cp: ply >= 15 ? -900 : 0 })),
    };
    const gs = [a, b];
    const profile: PlayerProfile = buildPlayerProfile(gs, new Map([[a.id, analysis]]), "taro", {
      worstMoves: 0,
    });
    return { stats: computePlayerStats(gs, "taro"), profile };
  }

  it("平均が無いときは点線も説明文も出ず、あるときは両方出る", async () => {
    const { stats, profile } = await setup();
    render(<ProfileCard stats={stats} profile={profile} others={[]} />);
    expect(screen.getByText("レーダーの見方")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("点線は");
    expect(baselinePath()).toBeNull();
    cleanup();
    render(<ProfileCard stats={stats} profile={profile} others={[profile]} />);
    expect(document.body.textContent).toContain("点線は登録している他の対局者の平均");
    expect(baselinePath()).not.toBeNull();
  });
});
