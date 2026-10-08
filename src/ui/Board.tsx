import { parseBoardSfen } from "../core/position";
import type { Side } from "../core/stats";

const GLYPH: Record<string, string> = {
  P: "歩",
  L: "香",
  N: "桂",
  S: "銀",
  G: "金",
  B: "角",
  R: "飛",
  K: "玉",
  "+P": "と",
  "+L": "杏",
  "+N": "圭",
  "+S": "全",
  "+B": "馬",
  "+R": "龍",
};
const WHITE_KING = "王";
const HAND_ORDER = ["R", "B", "G", "S", "N", "L", "P"];
const FILE_LABELS = ["９", "８", "７", "６", "５", "４", "３", "２", "１"];
const RANK_LABELS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

const CELL = 40;
const PAD = 16;
const SIZE = CELL * 9 + PAD * 2;

/** 盤の上に示す候補手。移動先のマスを判定の色で囲む */
export interface BoardMark {
  usi: string;
  tone: "good" | "bad" | "none";
  selected?: boolean;
}

const MARK_COLOR: Record<BoardMark["tone"], string> = {
  good: "var(--good)",
  bad: "var(--danger)",
  none: "var(--muted)",
};

interface Props {
  /** 局面キーまたは SFEN */
  sfen: string;
  /** 直前の指し手 (USI)。移動先をハイライトする。 */
  lastMoveUsi?: string;
  /** 後手側から見た向きにする */
  flipped?: boolean;
  /** 先手の対局者 (名前・段位など)。渡すと盤の上下に出す */
  black?: string;
  /** 後手の対局者 */
  white?: string;
  /** 本人 (登録した対局者) の側。名前を強調する */
  tracked?: Side | null;
  /** 候補手の印 */
  marks?: BoardMark[];
  /** 渡すとマスを押せるようにする。マスは USI ("2d") */
  onSquare?: (square: string) => void;
  /** 渡すと手番側の持ち駒を押せるようにする。駒は SFEN の大文字 ("G") */
  onHand?: (piece: string) => void;
  /** 選んでいるマス (USI) か持ち駒 ("G*") */
  selected?: string;
}

function parseHand(hand: string): Array<{ piece: string; count: number; black: boolean }> {
  if (hand === "-") return [];
  const out: Array<{ piece: string; count: number; black: boolean }> = [];
  let num = "";
  for (const ch of hand) {
    if (ch >= "0" && ch <= "9") {
      num += ch;
      continue;
    }
    out.push({
      piece: ch.toUpperCase(),
      count: num ? Number(num) : 1,
      black: ch === ch.toUpperCase(),
    });
    num = "";
  }
  return out;
}

interface SideRowProps {
  hand: string;
  black: boolean;
  name?: string;
  toMove: boolean;
  tracked: boolean;
  onHand?: (piece: string) => void;
  selected?: string;
}

/** 盤の上下に出す 1 行: 先後の印・対局者名・手番・持ち駒 */
function SideRow({ hand, black, name, toMove, tracked, onHand, selected }: SideRowProps) {
  const pieces = parseHand(hand)
    .filter((p) => p.black === black)
    .sort((a, b) => HAND_ORDER.indexOf(a.piece) - HAND_ORDER.indexOf(b.piece));
  const side = black ? "先手" : "後手";
  return (
    <div className={`side-row${toMove ? " to-move" : ""}`} aria-label={side}>
      <div className="side-name">
        <span className={tracked ? "player tracked" : "player"}>
          {black ? "☗" : "☖"}
          {name ? ` ${name}` : ""}
        </span>
        {toMove && <span className="turn-badge">手番</span>}
      </div>
      <div className="hand" aria-label={`${side}の持ち駒`}>
        {pieces.length === 0 && <span className="muted">持ち駒なし</span>}
        {pieces.map((p) =>
          onHand && toMove ? (
            <button
              key={p.piece}
              type="button"
              className="piece"
              aria-label={`持ち駒の${GLYPH[p.piece]}`}
              aria-pressed={selected === `${p.piece}*`}
              onClick={() => onHand(p.piece)}
            >
              {GLYPH[p.piece]}
              {p.count > 1 ? p.count : ""}
            </button>
          ) : (
            <span key={p.piece} className="piece">
              {GLYPH[p.piece]}
              {p.count > 1 ? p.count : ""}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

export function Board({
  sfen,
  lastMoveUsi,
  flipped = false,
  black,
  white,
  tracked,
  marks = [],
  onSquare,
  onHand,
  selected,
}: Props) {
  const [boardPart = "", turn = "b", handPart = "-"] = sfen.trim().split(/\s+/);
  const pieces = parseBoardSfen(boardPart);
  const target = lastMoveUsi ? lastMoveUsi.slice(2, 4) : "";
  const targetFile = target ? Number(target[0]) : 0;
  const targetRank = target ? target.charCodeAt(1) - 96 : 0;

  const cellX = (file: number) => PAD + (flipped ? file - 1 : 9 - file) * CELL;
  const cellY = (rank: number) => PAD + (flipped ? 9 - rank : rank - 1) * CELL;
  const blackToMove = turn === "b";
  const row = (isBlack: boolean) => (
    <SideRow
      hand={handPart}
      black={isBlack}
      name={isBlack ? black : white}
      toMove={isBlack === blackToMove}
      tracked={tracked === (isBlack ? "black" : "white")}
      onHand={onHand}
      selected={selected}
    />
  );

  return (
    <div className="board-wrap">
      {row(flipped)}
      <svg
        className="board"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role={onSquare ? "group" : "img"}
        aria-label="盤面"
      >
        <rect x={PAD} y={PAD} width={CELL * 9} height={CELL * 9} fill="var(--board)" />
        {targetFile > 0 && (
          <rect
            x={cellX(targetFile)}
            y={cellY(targetRank)}
            width={CELL}
            height={CELL}
            fill="var(--highlight)"
            opacity={0.7}
          />
        )}
        {Array.from({ length: 10 }, (_, i) => (
          <g key={i} stroke="var(--board-line)" strokeWidth={i === 0 || i === 9 ? 1.5 : 0.8}>
            <line x1={PAD + i * CELL} y1={PAD} x2={PAD + i * CELL} y2={PAD + CELL * 9} />
            <line x1={PAD} y1={PAD + i * CELL} x2={PAD + CELL * 9} y2={PAD + i * CELL} />
          </g>
        ))}
        {[3, 6].flatMap((x) =>
          [3, 6].map((y) => (
            <circle
              key={`${x}${y}`}
              cx={PAD + x * CELL}
              cy={PAD + y * CELL}
              r={2.5}
              fill="var(--board-line)"
            />
          )),
        )}
        {FILE_LABELS.map((label, i) => (
          <text
            key={label}
            x={PAD + (flipped ? 8 - i : i) * CELL + CELL / 2}
            y={PAD - 4}
            fontSize={10}
            textAnchor="middle"
            fill="var(--muted)"
          >
            {label}
          </text>
        ))}
        {RANK_LABELS.map((label, i) => (
          <text
            key={label}
            x={PAD + CELL * 9 + 4}
            y={PAD + (flipped ? 8 - i : i) * CELL + CELL / 2 + 4}
            fontSize={10}
            fill="var(--muted)"
          >
            {label}
          </text>
        ))}
        {marks.map((m) => {
          const file = Number(m.usi[2]);
          const rank = (m.usi.charCodeAt(3) || 0) - 96;
          if (!(file >= 1 && file <= 9 && rank >= 1 && rank <= 9)) return null;
          return (
            <rect
              key={m.usi}
              className="board-mark"
              data-usi={m.usi}
              x={cellX(file) + 2}
              y={cellY(rank) + 2}
              width={CELL - 4}
              height={CELL - 4}
              rx={4}
              fill="none"
              stroke={MARK_COLOR[m.tone]}
              strokeWidth={m.selected ? 4 : 2}
              strokeDasharray={m.selected ? undefined : "4 3"}
            />
          );
        })}
        {pieces.map((p) => {
          const black = p.piece.replace("+", "") === p.piece.replace("+", "").toUpperCase();
          const key = p.piece.toUpperCase();
          const glyph = !black && key === "K" ? WHITE_KING : (GLYPH[key] ?? "?");
          const cx = cellX(p.file) + CELL / 2;
          const cy = cellY(p.rank) + CELL / 2;
          const rotate = black === !flipped ? 0 : 180;
          const promoted = p.piece.startsWith("+");
          return (
            <text
              key={`${p.file}${p.rank}`}
              x={cx}
              y={cy + 8}
              fontSize={24}
              textAnchor="middle"
              fill={promoted ? "#b91c1c" : "#1c1917"}
              transform={`rotate(${rotate} ${cx} ${cy})`}
              fontWeight={600}
            >
              {glyph}
            </text>
          );
        })}
        {selected && /^[1-9][a-i]$/.test(selected) && (
          <rect
            className="board-selected"
            x={cellX(Number(selected[0]))}
            y={cellY(selected.charCodeAt(1) - 96)}
            width={CELL}
            height={CELL}
            fill="var(--accent)"
            opacity={0.3}
          />
        )}
        {onSquare &&
          Array.from({ length: 81 }, (_, i) => {
            const file = (i % 9) + 1;
            const rank = Math.floor(i / 9) + 1;
            const usi = `${file}${String.fromCharCode(96 + rank)}`;
            return (
              <rect
                key={usi}
                role="button"
                aria-label={`${file}${RANK_LABELS[rank - 1]}`}
                data-square={usi}
                x={cellX(file)}
                y={cellY(rank)}
                width={CELL}
                height={CELL}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onClick={() => onSquare(usi)}
              />
            );
          })}
      </svg>
      {row(!flipped)}
    </div>
  );
}
