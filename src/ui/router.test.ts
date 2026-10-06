import { describe, expect, it } from "vitest";
import { hashFor, parseHash, type Route } from "./router";

describe("router", () => {
  it("絞り込みつき一覧の URL を往復できる", () => {
    const route: Route = {
      kind: "list",
      query: {
        player: "a/b c&d",
        service: "wars",
        shape: "taikokei",
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
