import { playerSide } from "../core/stats";
import type { GameRecord } from "../core/types";
import { formatDate } from "./labels";
import { navigate } from "./router";

/** 対局へのボタン。押すとその対局の `ply` 手目へ飛ぶ */
export function GameButtons({
  gameIds,
  ply,
  byId,
  name,
}: {
  gameIds: string[];
  ply: number;
  byId: Map<string, GameRecord>;
  name: string;
}) {
  return (
    <div className="row">
      {gameIds.map((id) => {
        const g = byId.get(id);
        return (
          <button key={id} className="ghost" onClick={() => navigate({ kind: "game", id, ply })}>
            {g
              ? `${formatDate(g.startedAt).slice(0, 10)} vs ${playerSide(g, name) === "black" ? g.white : g.black}`
              : id}
          </button>
        );
      })}
    </div>
  );
}
