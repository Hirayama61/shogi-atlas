// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseKifu } from "../core/parse";
import {
  QUEST_KIF_TIMEOUT,
  USI_ANAGUMA_VS_SHIKEN,
  USI_SHIKEN_VS_FUNA,
  WARS_KIF,
} from "../core/__tests__/fixtures";
import { db } from "../db/db";
import type { AnalysisRecord } from "../core/analysis";
import App from "../App";
import { outcomeFor, playerSide } from "../core/stats";
import { GameList } from "./GameList";
import { GameViewer } from "./GameViewer";
import { PlayerList } from "./PlayerList";
import { PlayerPage } from "./PlayerPage";
import { fieldQuery, hashFor, parseHash, type ListQuery } from "./router";

const source = { kind: "paste" as const };

async function seed() {
  const a = await parseKifu(WARS_KIF, { source, tags: ["Sukonbu3"] });
  const b = await parseKifu(USI_SHIKEN_VS_FUNA, { source });
  const c = await parseKifu(USI_ANAGUMA_VS_SHIKEN, { source });
  Object.assign(b, {
    black: "Sukonbu3",
    white: "x1",
    result: "black",
    startedAt: "2026-02-01T00:00:00",
    tags: ["Sukonbu3"],
  });
  Object.assign(c, {
    black: "Sukonbu3",
    white: "x2",
    result: "white",
    startedAt: "2026-03-01T00:00:00",
    tags: ["Sukonbu3"],
  });
  await db.games.bulkPut([a, b, c]);
  return { a, b, c };
}

describe("UI", () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.analyses.clear();
    location.hash = "";
  });
  afterEach(cleanup);

  it("GameList: 一覧に対局と概要が出る", async () => {
    await seed();
    render(<GameList />);
    await waitFor(() => expect(screen.getByText(/3 \/ 3 局/)).toBeInTheDocument());
    expect(screen.getByText("☖nemushi_")).toBeInTheDocument();
    expect(screen.getAllByText(/四間飛車/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("undefined");
  });

  it("GameList: 出典サービスのバッジが出て、文字入力の絞り込み欄は無い", async () => {
    await seed();
    const q = await parseKifu(QUEST_KIF_TIMEOUT, { source });
    Object.assign(q, { startedAt: "2026-04-01T00:00:00" });
    await db.games.put(q);
    render(<GameList />);
    await waitFor(() => expect(screen.getByText(/4 \/ 4 局/)).toBeInTheDocument());
    const badges = screen.getAllByLabelText("出典").map((el) => el.textContent);
    expect(badges).toEqual(["クエスト", "ウォーズ"]);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/絞り込み/)).not.toBeInTheDocument();
  });

  it("GameList: 絞り込み条件を渡すと、その対局者のその戦法の対局だけが出る", async () => {
    const { a, b, c } = await seed();
    // 3 局とも Sukonbu3 が先手
    const opening = b.opening.blackOpening;
    render(<GameList query={fieldQuery("Sukonbu3", "opening", opening)} />);
    const expected = [a, b, c].filter((g) => g.opening.blackOpening === opening).length;
    await waitFor(() => expect(screen.getByText(`${expected} / 3 局`)).toBeInTheDocument());
    expect(screen.getByLabelText<HTMLSelectElement>("戦法").value).toBe(opening);
    expect(screen.getByLabelText<HTMLSelectElement>("戦法の側").value).toBe("self");
    expect(c.opening.blackOpening).not.toBe(opening);
    expect(screen.queryByText("☖x2")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "← Sukonbu3" }));
    expect(location.hash).toBe("#/player/Sukonbu3");
  });

  describe("GameList の絞り込み", () => {
    const count = (n: number, total = 3) =>
      waitFor(() => expect(screen.getByText(`${n} / ${total} 局`)).toBeInTheDocument());
    /** 選んで、URL 経由で画面に反映されるまで待つ */
    const choose = async (label: string, value: string) => {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      await waitFor(() =>
        expect(screen.getByLabelText<HTMLSelectElement>(label).value).toBe(value),
      );
    };
    const query = (): ListQuery => {
      const r = parseHash(location.hash);
      return r.kind === "list" ? (r.query ?? {}) : {};
    };
    const optionValues = (label: string) =>
      Array.from(screen.getByLabelText<HTMLSelectElement>(label).options).map((o) => o.value);

    it("戦法と囲いを別々に選び、先手 / 後手 / どちらでも を切り替えられる", async () => {
      const { a, b, c } = await seed();
      const all = [a, b, c];
      location.hash = "#/";
      render(<App />);
      await count(3);
      const opening = b.opening.blackOpening;
      const n = (f: (g: (typeof all)[number]) => boolean) => all.filter(f).length;
      // 選択肢に局数が付く
      expect(
        screen.getByRole("option", {
          name: `${opening} (${n((g) => [g.opening.blackOpening, g.opening.whiteOpening].includes(opening))})`,
        }),
      ).toBeInTheDocument();
      await choose("戦法", opening);
      await waitFor(() => expect(query()).toEqual({ opening }));
      await count(n((g) => [g.opening.blackOpening, g.opening.whiteOpening].includes(opening)));
      await choose("戦法の側", "white");
      await waitFor(() => expect(query()).toEqual({ opening, openingSide: "white" }));
      await count(n((g) => g.opening.whiteOpening === opening));
      await choose("戦法の側", "black");
      await count(n((g) => g.opening.blackOpening === opening));
      // 対局者なしでは本人 / 相手は出ない
      expect(optionValues("戦法の側")).toEqual(["", "black", "white"]);

      await choose("戦法", "");
      const castle = b.opening.whiteCastle;
      await choose("囲い", castle);
      await waitFor(() => expect(query()).toEqual({ openingSide: "black", castle }));
      await count(n((g) => [g.opening.blackCastle, g.opening.whiteCastle].includes(castle)));
      await choose("囲いの側", "white");
      await count(n((g) => g.opening.whiteCastle === castle));
      await choose("囲いの側", "black");
      await count(n((g) => g.opening.blackCastle === castle));
    });

    it("勝敗で絞り込み、対局者を指定すると勝ち / 負けでも選べる", async () => {
      const { a, b, c } = await seed();
      const all = [a, b, c];
      location.hash = "#/";
      render(<App />);
      await count(3);
      expect(optionValues("勝敗")).toEqual(["", "black", "white", "other"]);
      await choose("勝敗", "black");
      await count(all.filter((g) => g.result === "black").length);
      await choose("勝敗", "other");
      await count(all.filter((g) => g.result === "draw" || g.result === "unknown").length);

      await choose("勝敗", "");
      await choose("対局者", "Sukonbu3");
      await waitFor(() => expect(optionValues("勝敗")).toContain("loss"));
      const mine = all.filter((g) => playerSide(g, "Sukonbu3") !== null);
      await count(mine.length);
      await choose("勝敗", "loss");
      const losses = mine.filter(
        (g) => outcomeFor(g.result, playerSide(g, "Sukonbu3")!) === "loss",
      );
      await count(losses.length);
      expect(losses.length).toBeGreaterThan(0);
      expect(query()).toEqual({ player: "Sukonbu3", result: "loss" });
      // 対局者を外すと効かない条件も消える
      await choose("対局者", "");
      await waitFor(() => expect(query()).toEqual({}));
    });

    it("条件は URL から再現でき、組み合わせて一括で消せる", async () => {
      const { a, b, c } = await seed();
      const q: ListQuery = {
        player: "Sukonbu3",
        opening: b.opening.whiteOpening,
        openingSide: "opponent",
        result: "win",
      };
      location.hash = hashFor({ kind: "list", query: q });
      render(<App />);
      const expected = [a, b, c].filter((g) => {
        const side = playerSide(g, "Sukonbu3");
        if (!side) return false;
        const opp = side === "black" ? g.opening.whiteOpening : g.opening.blackOpening;
        return opp === q.opening && outcomeFor(g.result, side) === "win";
      });
      expect(expected.length).toBeGreaterThan(0);
      await count(expected.length);
      expect(screen.getByLabelText<HTMLSelectElement>("戦法の側").value).toBe("opponent");
      expect(screen.getByLabelText<HTMLSelectElement>("勝敗").value).toBe("win");
      await choose("出典の絞り込み", "quest");
      await count(0);
      fireEvent.click(screen.getByRole("button", { name: "条件をすべて消す" }));
      await count(3);
      expect(location.hash).toBe("#/");
      expect(screen.queryByRole("button", { name: "条件をすべて消す" })).not.toBeInTheDocument();
    });
  });

  it("PlayerList: 文字入力の絞り込み欄は無い", async () => {
    await seed();
    render(<PlayerList />);
    await waitFor(() => expect(screen.getByText("Sukonbu3")).toBeInTheDocument());
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("GameViewer: 盤面・戦法・囲い・同じ局面の対局が出る", async () => {
    const { a, b } = await seed();
    render(<GameViewer id={b.id} initialPly={18} />);
    await waitFor(() => expect(screen.getByText(/18 手目/)).toBeInTheDocument());
    expect(screen.getByRole("img", { name: "盤面" })).toBeInTheDocument();
    expect(screen.getByText(/四間飛車 · 囲い: 本美濃/)).toBeInTheDocument();
    expect(screen.getByText(/居飛車 · 囲い: 舟囲い/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("undefined");
    // 1 手目の局面は a とも共通
    render(<GameViewer id={a.id} initialPly={1} />);
    await waitFor(() => expect(screen.getByText("同じ局面を通った対局")).toBeInTheDocument());
  });

  it("PlayerList: 登録した対局者だけを出し、切り替えで相手も出す", async () => {
    await seed();
    render(<PlayerList />);
    await waitFor(() => expect(screen.getByText("Sukonbu3")).toBeInTheDocument());
    expect(screen.queryByText("nemushi_")).not.toBeInTheDocument();
    screen.getByLabelText("対局相手も表示").click();
    await waitFor(() => expect(screen.getByText("nemushi_")).toBeInTheDocument());
  });

  it("PlayerPage: 成績と戦法の内訳が出る", async () => {
    await seed();
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(screen.getByText(/3 局 · 1 勝 2 敗/)).toBeInTheDocument());
    expect(screen.getByText("採用戦法")).toBeInTheDocument();
    expect(screen.getByText("相手の戦法別")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("undefined");
  });

  it("PlayerPage: 戦法・囲い・相手の戦法の行から絞り込み済みの一覧へ飛ぶ", async () => {
    const { b } = await seed();
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(screen.getByText(/3 局 · 1 勝 2 敗/)).toBeInTheDocument());
    const table = (title: string) => screen.getByText(title).closest(".panel") as HTMLElement;
    const cases = [
      ["採用戦法", "opening", b.opening.blackOpening],
      ["囲い", "castle", b.opening.blackCastle],
      ["相手の戦法別", "vsOpening", b.opening.whiteOpening],
    ] as const;
    for (const [title, field, value] of cases) {
      const link = within(table(title)).getByRole("link", { name: value });
      const route = { kind: "list" as const, query: fieldQuery("Sukonbu3", field, value) };
      expect(link).toHaveAttribute("href", hashFor(route));
      fireEvent.click(link.closest("tr")!);
      expect(parseHash(location.hash)).toEqual(route);
    }
  });

  it("PlayerPage: 分岐点は戦法ごとにまとまり、1 局面 1 行で閉じている", async () => {
    const { b } = await seed();
    await db.games.put({ ...b, id: "b-copy", startedAt: "2026-04-01T00:00:00" });
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() =>
      expect(screen.getAllByText(/手目まで共通 · 2 局/).length).toBeGreaterThan(0),
    );
    const panel = screen
      .getByText("分岐点", { selector: "strong" })
      .closest(".panel") as HTMLElement;
    const branch = within(panel)
      .getByText(/手目まで共通 · 2 局/)
      .closest("details");
    expect(branch).not.toBeNull();
    expect(branch!.open).toBe(false);
    expect(branch!.querySelector("summary svg")).toBeNull();
    expect(branch!.querySelectorAll("button")).toHaveLength(2);
    expect(panel.querySelector(".branch-group")?.textContent).toContain(b.opening.blackOpening);
  });

  it("PlayerPage: 分岐点は戦法 × 判定で分かれ、本人の手と判定が出て、該当棋譜の手数へ飛べる", async () => {
    const { b } = await seed();
    const b2 = await parseKifu(USI_SHIKEN_VS_FUNA.replace("1g1f 1c1d", "9g9f 9c9d"), { source });
    Object.assign(b2, {
      black: "Sukonbu3",
      white: "x3",
      result: "white",
      startedAt: "2026-04-01T00:00:00",
      tags: ["Sukonbu3"],
    });
    await db.games.put(b2);
    const flat = Array.from({ length: 21 }, () => 0);
    const analysis = (id: string, cps: number[], best: Record<number, string> = {}) => ({
      schema: 1 as const,
      id,
      engine: { name: "fake", depth: 1 },
      analyzedAt: "2026-01-01T00:00:00Z",
      plies: cps.map((cp, ply) => (best[ply] ? { ply, cp, best: best[ply] } : { ply, cp })),
    });
    await db.analyses.bulkPut([
      analysis(b.id, flat),
      analysis(
        b2.id,
        flat.map((cp, ply) => (ply >= 19 ? -400 : cp)),
        { 18: "1g1f" },
      ),
    ]);
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(screen.getByText(/悪手を指した分岐 \(1\)/)).toBeInTheDocument());
    const panel = screen
      .getByText("分岐点", { selector: "strong" })
      .closest(".panel") as HTMLElement;
    const kind = panel.querySelector(".branch-kind.mistake") as HTMLElement;
    expect(kind.closest(".branch-group")?.textContent).toContain(b.opening.blackOpening);
    const branch = within(kind)
      .getByText(/18 手目まで共通 · 2 局/)
      .closest("details")!;
    expect(branch.open).toBe(false);
    expect(branch.querySelector("summary")?.textContent).toContain(
      "本人の手: ▲1六歩 ×1 (最善) / ▲9六歩 ×1 (悪手, 最善 ▲1六歩)",
    );
    fireEvent.click(within(branch).getAllByRole("button")[0]!);
    expect(parseHash(location.hash)).toMatchObject({ kind: "game", ply: 18 });
  });

  it("PlayerPage: 戦型ポートフォリオは条件ごとに畳まれ、行から該当対局の一覧へ飛ぶ", async () => {
    const { b, c } = await seed();
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(screen.getByText("戦型ポートフォリオ")).toBeInTheDocument());
    const panel = screen.getByText("戦型ポートフォリオ").closest(".panel") as HTMLElement;
    const groups = panel.querySelectorAll("details.portfolio");
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) expect((g as HTMLDetailsElement).open).toBe(false);
    // 先手の 2 局 (b, c) と後手の 1 局 (a) がすべて入る
    const total = Array.from(groups).reduce(
      (n, g) => n + Number(/(\d+) 局/.exec(g.querySelector("summary")!.textContent!)![1]),
      0,
    );
    expect(total).toBe(3);

    const label = `${b.opening.blackOpening} + ${b.opening.blackCastle}`;
    const link = within(panel).getAllByRole("link", { name: label })[0]!;
    fireEvent.click(link.closest("tr")!);
    const route = parseHash(location.hash);
    expect(route).toMatchObject({
      kind: "list",
      portfolio: {
        player: "Sukonbu3",
        condition: { side: "black", opening: b.opening.blackOpening },
      },
    });
    cleanup();
    if (route.kind !== "list" || !route.portfolio) throw new Error("unreachable");
    const portfolio = route.portfolio;
    render(<GameList portfolio={portfolio} />);
    const expected = [b, c].filter(
      (g) =>
        g.opening.whiteOpening === portfolio.condition.vsOpening &&
        `${g.opening.blackOpening} + ${g.opening.blackCastle}` === label,
    ).length;
    await waitFor(() =>
      expect(screen.getByText(new RegExp(`${expected} / 3 局`))).toBeInTheDocument(),
    );
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("PlayerPage: 対局が無い人", async () => {
    render(<PlayerPage name="nobody" />);
    await waitFor(() => expect(screen.getByText(/nobody の対局がありません/)).toBeInTheDocument());
  });

  it("GameViewer: 解析があれば評価値グラフと悪手の印、解析つき KIF が出る", async () => {
    const { a } = await seed();
    const cps = [0, 10, 0, 20, 0, -400, -380, -400, 600, 580, 600, 620, 600, 610, 600];
    const analysis: AnalysisRecord = {
      schema: 1,
      id: a.id,
      engine: { name: "fake", depth: 1 },
      analyzedAt: "2026-01-01T00:00:00Z",
      plies: cps.map((cp, ply) =>
        ply === 7 ? { ply, cp, best: "7a6b", pv: ["7a6b"] } : { ply, cp },
      ),
    };
    await db.analyses.put(analysis);
    render(<GameViewer id={a.id} initialPly={8} />);
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "評価値の推移" })).toBeInTheDocument(),
    );
    expect(screen.getByText("解析つき KIF をコピー")).toBeInTheDocument();
    expect(screen.getAllByText("??").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/大悪手/).length).toBeGreaterThan(0);
    expect(screen.getByText(/-400 → \+600/)).toBeInTheDocument();
    expect(screen.getByText("平均損失とは")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("undefined");
  });

  it("PlayerPage: 解析があれば弱点プロファイルが出る", async () => {
    const { b } = await seed();
    const cps = Array.from({ length: 21 }, (_, i) => (i >= 15 ? -900 : 0));
    await db.analyses.put({
      schema: 1,
      id: b.id,
      engine: { name: "fake", depth: 1 },
      analyzedAt: "2026-01-01T00:00:00Z",
      plies: cps.map((cp, ply) => ({ ply, cp })),
    });
    render(<PlayerPage name="Sukonbu3" />);
    await waitFor(() => expect(screen.getByText(/解析済み 1 局/)).toBeInTheDocument());
    expect(screen.getByText("痛かった手")).toBeInTheDocument();
    expect(screen.getByText("局面を開く")).toBeInTheDocument();
    // 痛かった手・分岐点は初期状態で閉じている
    expect(document.querySelectorAll("details.worst").length).toBeGreaterThan(0);
    expect(document.querySelector("details.worst[open], details.branch[open]")).toBeNull();
    // 平均損失の意味と目安
    expect(screen.getByText("平均損失とは")).toBeInTheDocument();
    expect(document.body.textContent).toContain("最善手を指した場合と比べて");
    expect(document.body.textContent).toContain("120 以上で疑問手");
    expect(document.body.textContent).not.toContain("undefined");
    expect(document.body.textContent).not.toContain("NaN");
  });
});
