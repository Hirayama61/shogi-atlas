import { describe, expect, it } from "vitest";
import { hashFor, parseHash, type Route } from "./router";

describe("router", () => {
  it("絞り込みつき一覧の URL を往復できる", () => {
    const route: Route = {
      kind: "list",
      filter: { player: "a/b c", field: "vsOpening", value: "四間飛車" },
    };
    const hash = hashFor(route);
    expect(hash.startsWith("#/player/")).toBe(true);
    expect(parseHash(hash)).toEqual(route);
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
