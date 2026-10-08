// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USI_KAKUGAWARI, USI_SHIKEN_VS_FUNA } from "../core/__tests__/fixtures";
import { parseKifu } from "../core/parse";
import type { GameRecord } from "../core/types";
import { db } from "../db/db";
import App from "../App";
import { hashFor, type Route } from "./router";

const source = { kind: "paste" as const };

async function game(
  usi: string,
  black: string,
  white: string,
  startedAt: string,
): Promise<GameRecord> {
  const g = await parseKifu(usi, { source });
  const tags = [black, white].filter((n) => n === "自分" || n === "ref" || n === "rival");
  return Object.assign(g, { black, white, result: "black" as const, startedAt, tags });
}

/**
 * 自分と ref が四間飛車 (18 手目で手が分かれる) と角換わり (先手の手は同じ) を先手で指している。
 * rival は登録しているが自分と同じ先後の対局が無い。
 */
async function seed() {
  const a = await game(USI_SHIKEN_VS_FUNA, "自分", "x1", "2026-02-01T00:00:00");
  const b = await game(
    USI_SHIKEN_VS_FUNA.replace("1g1f 1c1d", "9g9f 9c9d"),
    "ref",
    "x2",
    "2026-02-02T00:00:00",
  );
  const k1 = await game(USI_KAKUGAWARI, "自分", "x3", "2026-02-03T00:00:00");
  const k2 = await game(
    USI_KAKUGAWARI.replace(/6a5b$/, "9c9d"),
    "ref",
    "x4",
    "2026-02-04T00:00:00",
  );
  const r = await game(
    USI_KAKUGAWARI.replace(/6a5b$/, "1c1d"),
    "x5",
    "rival",
    "2026-02-05T00:00:00",
  );
  await db.games.bulkPut([a, b, k1, k2, r]);
  return { a, b, k1, k2 };
}

const COMPARE: Route = { kind: "compare", name: "自分", other: "ref" };

function items() {
  return Array.from(document.querySelectorAll<HTMLDetailsElement>("details.compare-item"));
}

describe("参考の対局者との比較", () => {
  beforeEach(async () => {
    await db.games.clear();
    await db.analyses.clear();
    await db.reports.clear();
    localStorage.clear();
    sessionStorage.clear();
    history.replaceState(null, "", "#/");
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });
  afterEach(cleanup);

  it("マイページで比較相手を選ぶと覚えておき、再読み込みしても同じ相手で比較が開く", async () => {
    await seed();
    history.replaceState(null, "", "#/player/自分");
    render(<App />);
    const select = await screen.findByRole("combobox", { name: "比較する相手" });
    expect(Array.from(select.querySelectorAll("option")).map((o) => o.value)).toEqual(
      expect.arrayContaining(["ref", "rival"]),
    );
    fireEvent.change(select, { target: { value: "rival" } });
    cleanup();

    render(<App />);
    const again = await screen.findByRole("combobox", { name: "比較する相手" });
    expect(again).toHaveValue("rival");
    fireEvent.change(again, { target: { value: "ref" } });
    fireEvent.click(screen.getByRole("button", { name: "同じ局面の手を比べる" }));
    await waitFor(() => expect(location.hash).toBe(hashFor(COMPARE)));
    await screen.findByText("自分 と ref の比較");
    cleanup();

    history.replaceState(null, "", "#/player/自分");
    render(<App />);
    expect(await screen.findByRole("combobox", { name: "比較する相手" })).toHaveValue("ref");
  });

  it("自分以外の対局者ページには比較相手の選択が出ない", async () => {
    await seed();
    history.replaceState(null, "", "#/player/ref");
    render(<App />);
    await screen.findByText("戦型");
    expect(screen.queryByRole("combobox", { name: "比較する相手" })).toBeNull();
  });

  it("先頭に相手の戦法ごとの応手を並べ、分岐を戦法ごとにまとめる。一致は既定で隠して件数だけ出す", async () => {
    const { a, k1 } = await seed();
    history.replaceState(null, "", hashFor(COMPARE));
    render(<App />);
    await waitFor(() => expect(items()).toHaveLength(1));
    // 相手の戦法ごとの応手 (戦法 × 囲い、局数・勝率)
    const table = screen.getByText("相手の戦法ごとの応手").parentElement!;
    const row = Array.from(table.querySelectorAll("tr")).find((tr) =>
      tr.textContent?.startsWith(a.opening.whiteOpening),
    )!;
    expect(row).toHaveTextContent(`${a.opening.blackOpening} · ${a.opening.blackCastle}`);
    expect(row).toHaveTextContent("1 局 · 勝率 100%");

    expect(screen.getByText(/分岐 1 件 · 一致 1 件 · 数手以内に合流 0/)).toBeInTheDocument();
    const [only] = items();
    expect(only).toHaveTextContent(`${a.opening.blackOpening} · 18 手目 自分 ▲1六歩 / ref ▲9六歩`);
    expect(only).toHaveTextContent("先手");
    expect(only!.closest(".compare-group")!.querySelector("h3")).toHaveTextContent(
      a.opening.blackOpening,
    );

    fireEvent.click(screen.getByLabelText("一致と合流する分岐も出す"));
    await waitFor(() => expect(location.hash).toBe(hashFor({ ...COMPARE, all: true })));
    await waitFor(() => expect(items()).toHaveLength(2));
    const same = items().find((x) => x.textContent?.includes("12 手目"))!;
    expect(same).toHaveTextContent("一致");
    expect(same).toHaveTextContent(k1.opening.blackOpening);

    fireEvent.change(screen.getByRole("combobox", { name: "戦法" }), {
      target: { value: a.opening.blackOpening },
    });
    await waitFor(() =>
      expect(location.hash).toBe(
        hashFor({ ...COMPARE, opening: a.opening.blackOpening, all: true }),
      ),
    );
    await waitFor(() => expect(items()).toHaveLength(1));
    expect(items()[0]).toHaveTextContent("18 手目");
  });

  it("数手以内に合流する分岐は既定で隠し、件数だけ出す", async () => {
    const base = (rest: string) => USI_SHIKEN_VS_FUNA.replace("1g1f 1c1d", rest);
    await db.games.bulkPut([
      await game(base("1g1f 1c1d 9g9f 9c9d"), "自分", "x1", "2026-02-01T00:00:00"),
      await game(base("9g9f 1c1d 1g1f 9c9d 5g5f"), "自分", "x2", "2026-02-02T00:00:00"),
      await game(base("9g9f 1c1d 1g1f 9c9d"), "ref", "x3", "2026-02-03T00:00:00"),
      await game(base("9g9f 1c1d 2g2f"), "ref", "x4", "2026-02-04T00:00:00"),
    ]);
    history.replaceState(null, "", hashFor(COMPARE));
    render(<App />);
    await waitFor(() => expect(items()).toHaveLength(1));
    expect(screen.getByText(/分岐 1 件 · 一致 0 件 · 数手以内に合流 1/)).toBeInTheDocument();
    expect(items()[0]).toHaveTextContent("20 手目 自分 ▲1六歩 / ref ▲1六歩・▲2六歩");

    fireEvent.click(screen.getByLabelText("一致と合流する分岐も出す"));
    await waitFor(() => expect(items()).toHaveLength(2));
    expect(items()[0]).toHaveTextContent("合流");
    expect(items()[0]).toHaveTextContent("18 手目");
  });

  it("局面の盤面から各自の対局のその手数へ飛び、← 戻るで比較の画面に戻る", async () => {
    const { a, b } = await seed();
    history.replaceState(null, "", "#/player/自分");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "同じ局面の手を比べる" }));
    await waitFor(() => expect(items()).toHaveLength(1));
    const second = items()[0]!;
    second.open = true;
    expect(second.querySelector(".board, svg, table")).not.toBeNull();
    const own = Array.from(second.querySelectorAll("button")).find((x) =>
      x.textContent?.includes("vs x1"),
    )!;
    act(() => own.click());
    await waitFor(() => expect(location.hash).toBe(`#/game/${a.id}/18`));
    fireEvent.click(await screen.findByRole("button", { name: "← 戻る" }));
    await waitFor(() => expect(location.hash).toBe(hashFor(COMPARE)));

    await waitFor(() => expect(items()).toHaveLength(1));
    const theirs = Array.from(items()[0]!.querySelectorAll("button")).find((x) =>
      x.textContent?.includes("vs x2"),
    )!;
    act(() => theirs.click());
    await waitFor(() => expect(location.hash).toBe(`#/game/${b.id}/18`));
    fireEvent.click(await screen.findByRole("button", { name: "← 戻る" }));
    await waitFor(() => expect(location.hash).toBe(hashFor(COMPARE)));

    // 比較の画面の ← 戻るはマイページへ
    fireEvent.click(await screen.findByRole("button", { name: "← 戻る" }));
    await waitFor(() => expect(location.hash).toBe("#/player/%E8%87%AA%E5%88%86"));
  });

  it("共通局面が無いときは理由が出る", async () => {
    await seed();
    history.replaceState(null, "", hashFor({ kind: "compare", name: "自分", other: "rival" }));
    render(<App />);
    expect(
      await screen.findByText(/共通の局面がありません。同じ先後で指した対局がありません/),
    ).toBeInTheDocument();
  });
});
