import { describe, expect, it } from "vitest";
import { hashFor, parseHash, type Route } from "./router";

describe("router", () => {
  it("分岐点の学習画面の URL を往復できる", () => {
    const route: Route = {
      kind: "branch",
      name: "a/b",
      key: "lnsgk2nl/1r4gs1/p1pppp1pp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b P",
    };
    const hash = hashFor(route);
    expect(hash.startsWith("#/player/a%2Fb/branch/")).toBe(true);
    expect(parseHash(hash)).toEqual(route);
    // 戦法の詳細と学習画面の状態 (手数・候補・続きの対局) も往復する
    const state: Route = {
      ...route,
      view: { quadrant: "furiVsIbisha", opening: "ノーマル四間飛車" },
      at: 19,
      pick: "9g9f",
      line: "b2b2b2",
    };
    expect(parseHash(hashFor(state))).toEqual(state);
  });

  it("比較の画面の URL を往復できる", () => {
    const plain: Route = { kind: "compare", name: "自分", other: "a/b" };
    expect(hashFor(plain)).toBe("#/player/%E8%87%AA%E5%88%86/compare/a%2Fb");
    expect(parseHash(hashFor(plain))).toEqual(plain);
    const filtered: Route = { ...plain, opening: "四間飛車", all: true };
    expect(parseHash(hashFor(filtered))).toEqual(filtered);
  });

  it("終盤力強化の URL を往復できる", () => {
    expect(hashFor({ kind: "endgame" })).toBe("#/endgame");
    expect(parseHash("#/endgame")).toEqual({ kind: "endgame" });
    const route: Route = {
      kind: "endgame",
      castle: "美濃囲い",
      group: "attack|美濃囲い|88:P,P,P,.,K,S,.,.,.",
      problem: "abc:41",
    };
    expect(parseHash(hashFor(route))).toEqual(route);
    const mate: Route = {
      kind: "endgame",
      mode: "mate",
      castle: "穴熊",
      mate: "3",
      problem: "mate:abc:41",
    };
    expect(hashFor(mate)).toBe(
      "#/endgame?mode=mate&castle=%E7%A9%B4%E7%86%8A&mate=3&problem=mate%3Aabc%3A41",
    );
    expect(parseHash(hashFor(mate))).toEqual(mate);
  });

  it("絞り込みつき一覧の URL を往復できる", () => {
    const route: Route = {
      kind: "list",
      query: {
        player: "a/b c&d",
        service: "wars",
        shape: "taikokei",
        selfStyle: "ibisha",
        selfSide: "white",
        opening: "四間飛車",
        openingSide: "opponent",
        castle: "美濃囲い",
        castleSide: "white",
        result: "loss",
      },
    };
    const hash = hashFor(route);
    expect(hash.startsWith("#/games?")).toBe(true);
    expect(parseHash(hash)).toEqual(route);
    expect(hashFor({ kind: "list", query: {} })).toBe("#/");
    expect(parseHash("#/games?result=bogus&shape=x&openingSide=up")).toEqual({ kind: "list" });
  });

  it("対局者ページの階層 (区分・戦法の側・戦法) を URL で往復できる", () => {
    const routes: Route[] = [
      { kind: "player", name: "a/b" },
      { kind: "player", name: "a/b", view: { quadrant: "aiIbisha" } },
      { kind: "player", name: "a/b", view: { quadrant: "furiVsIbisha", axis: "opponent" } },
      { kind: "player", name: "a/b", view: { quadrant: "ibishaVsFuri", opening: "舟囲い急戦&x" } },
      {
        kind: "player",
        name: "a/b",
        view: { quadrant: "aiFuribisha", axis: "opponent", opening: "向かい飛車" },
      },
      { kind: "player", name: "a/b", view: { quadrant: "aiIbisha", side: "white" } },
      {
        kind: "player",
        name: "a/b",
        view: { quadrant: "furiVsIbisha", axis: "opponent", side: "black", opening: "x" },
      },
    ];
    for (const route of routes) expect(parseHash(hashFor(route))).toEqual(route);
    expect(hashFor(routes[1]!)).toBe("#/player/a%2Fb?style=aiIbisha");
    expect(hashFor(routes[5]!)).toBe("#/player/a%2Fb?style=aiIbisha&side=white");
    // 知らない先後は両方
    expect(parseHash("#/player/a?style=aiIbisha&side=up")).toEqual({
      kind: "player",
      name: "a",
      view: { quadrant: "aiIbisha" },
    });
    // 知らない区分は概要だけ
    expect(parseHash("#/player/a?style=bogus&opening=x")).toEqual({ kind: "player", name: "a" });
  });

  it("#6 の対局者ページの URL は同じ条件に読み替える", () => {
    expect(parseHash("#/player/a%2Fb/games/opening/%E5%9B%9B")).toEqual({
      kind: "list",
      query: { player: "a/b", opening: "四", openingSide: "self" },
    });
    expect(parseHash("#/player/a/games/castle/x")).toEqual({
      kind: "list",
      query: { player: "a", castle: "x", castleSide: "self" },
    });
    expect(parseHash("#/player/a/games/vsOpening/x")).toEqual({
      kind: "list",
      query: { player: "a", opening: "x", openingSide: "opponent" },
    });
  });

  it("戦型ポートフォリオの行の URL を往復できる", () => {
    const route: Route = {
      kind: "list",
      portfolio: {
        player: "a/b",
        condition: {
          side: "white",
          vsStyle: "furibisha",
          vsOpening: "四間飛車",
          opening: "居飛車",
          castle: "舟囲い",
        },
      },
    };
    const hash = hashFor(route);
    expect(hash).toContain("/portfolio/white/furibisha/");
    expect(parseHash(hash)).toEqual(route);
    const withQuery: Route = { ...route, query: { result: "win" } };
    expect(parseHash(hashFor(withQuery))).toEqual(withQuery);
    expect(parseHash("#/player/x/portfolio/up/ibisha/a/b/c")).toEqual({ kind: "list" });
  });

  it("対局者ページと局面の URL はそのまま", () => {
    expect(parseHash(hashFor({ kind: "player", name: "x/y" }))).toEqual({
      kind: "player",
      name: "x/y",
    });
    expect(parseHash("#/game/abc/12")).toEqual({ kind: "game", id: "abc", ply: 12 });
  });

  it("外した検索ルートや知らない絞り込みはトップに戻る", () => {
    expect(parseHash("#/search")).toEqual({ kind: "list" });
    expect(parseHash("#/search/abc")).toEqual({ kind: "list" });
    expect(parseHash("#/player/x/games/unknown/y")).toEqual({ kind: "list" });
  });
});
