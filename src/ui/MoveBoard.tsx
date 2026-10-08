import { useMemo, useState } from "react";
import { Position, Square } from "tsshogi";
import { Board } from "./Board";

/** 局面で指せる手か */
function isValid(pos: Position | null, usi: string): boolean {
  if (!pos) return false;
  const move = pos.createMoveByUSI(usi);
  return !!move && pos.isValidMove(move);
}

/** 手番側の駒があるマスか */
function isOwn(pos: Position | null, sq: string): boolean {
  const square = Square.newByUSI(sq);
  const piece = square && pos?.board.at(square);
  return !!piece && piece.color === pos?.color;
}

interface Props {
  /** 手数つき SFEN */
  sfen: string;
  flipped?: boolean;
  lastMoveUsi?: string;
  /** 入力を受け付けない (相手の手番や判定中) */
  disabled?: boolean;
  /** 合法手が入力されたとき (USI) */
  onMove: (usi: string) => void;
}

/**
 * 盤で手を入力する。移動元 (盤の駒か持ち駒) → 移動先の順に押し、成れる手は成る / 成らないを選ぶ。
 * 合法手 (tsshogi の isValidMove) だけを受け付け、指せないマスを押したら選び直す。
 */
export function MoveBoard({ sfen, flipped, lastMoveUsi, disabled, onMove }: Props) {
  const pos = useMemo(() => Position.newBySFEN(sfen), [sfen]);
  const [state, setState] = useState<{ sfen: string; from: string | null; promote: string | null }>(
    { sfen, from: null, promote: null },
  );
  // 局面が変わったら選択を捨てる
  const current = state.sfen === sfen ? state : { sfen, from: null, promote: null };
  const { from, promote } = current;
  const set = (patch: Partial<typeof current>) => setState({ ...current, ...patch });

  const onSquare = (sq: string) => {
    if (disabled || promote) return;
    if (!from || from === sq) {
      set({ from: !from && isOwn(pos, sq) ? sq : null });
      return;
    }
    const usi = `${from}${sq}`;
    const plain = isValid(pos, usi);
    const promoted = !from.endsWith("*") && isValid(pos, `${usi}+`);
    if (plain && promoted) {
      set({ promote: usi });
      return;
    }
    if (plain || promoted) {
      set({ from: null });
      onMove(promoted ? `${usi}+` : usi);
      return;
    }
    // 指せない: 自分の駒を押したら選び直し、それ以外は選択を外す
    set({ from: isOwn(pos, sq) ? sq : null });
  };

  const choose = (usi: string | null) => {
    set({ from: null, promote: null });
    if (usi) onMove(usi);
  };

  return (
    <div className="move-board">
      <Board
        sfen={sfen}
        flipped={flipped}
        lastMoveUsi={lastMoveUsi}
        selected={from ?? undefined}
        onSquare={onSquare}
        onHand={disabled ? undefined : (piece) => set({ from: `${piece}*`, promote: null })}
      />
      {promote && (
        <div className="row promote-choice" role="group" aria-label="成りの選択">
          <span>成りますか?</span>
          <button type="button" onClick={() => choose(`${promote}+`)}>
            成る
          </button>
          <button type="button" className="ghost" onClick={() => choose(promote)}>
            成らない
          </button>
          <button type="button" className="ghost" onClick={() => choose(null)}>
            やめる
          </button>
        </div>
      )}
    </div>
  );
}
