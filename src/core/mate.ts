/**
 * 詰みの判定。tsshogi には合法手の列挙が無いので、全ての移動と打ちを試して確かめる。
 * 終局時の 1 局面にだけ使う想定 (将棋クエストは詰みのとき終局行を書かない)。
 */
import { Square, handPieceTypes, type ImmutablePosition } from "tsshogi";

/** 手番側に合法手が 1 つでもあるか */
export function hasLegalMove(position: ImmutablePosition): boolean {
  const color = position.color;
  for (const from of Square.all) {
    const piece = position.board.at(from);
    if (!piece || piece.color !== color) continue;
    for (const to of Square.all) {
      const move = position.createMove(from, to);
      if (!move) continue;
      if (position.isValidMove(move) || position.isValidMove(move.withPromote())) return true;
    }
  }
  const hand = position.hand(color);
  for (const type of handPieceTypes) {
    if (hand.count(type) === 0) continue;
    for (const to of Square.all) {
      if (position.board.at(to)) continue;
      const move = position.createMove(type, to);
      if (move && position.isValidMove(move)) return true;
    }
  }
  return false;
}

/** 手番側が詰まされているか (王手がかかっていて合法手が無い) */
export function isCheckmated(position: ImmutablePosition): boolean {
  return position.checked && !hasLegalMove(position);
}
