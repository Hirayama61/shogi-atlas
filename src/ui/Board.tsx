import { parseBoardSfen } from "../core/position";

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

interface Props {
  /** 局面キーまたは SFEN */
  sfen: string;
  /** 直前の指し手 (USI)。移動先をハイライトする。 */
  lastMoveUsi?: string;
  /** 後手側から見た向きにする */
  flipped?: boolean;
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

function HandRow({ hand, black }: { hand: string; black: boolean }) {
  const pieces = parseHand(hand)
    .filter((p) => p.black === black)
    .sort((a, b) => HAND_ORDER.indexOf(a.piece) - HAND_ORDER.indexOf(b.piece));
  return (
    <div className="hand" aria-label={black ? "先手の持ち駒" : "後手の持ち駒"}>
      <span className="muted">{black ? "☗" : "☖"}</span>
      {pieces.length === 0 && <span className="muted">なし</span>}
      {pieces.map((p) => (
        <span key={p.piece} className="piece">
          {GLYPH[p.piece]}
          {p.count > 1 ? p.count : ""}
        </span>
      ))}
    </div>
  );
}

export function Board({ sfen, lastMoveUsi, flipped = false }: Props) {
  const [boardPart = "", turn = "b", handPart = "-"] = sfen.trim().split(/\s+/);
  const pieces = parseBoardSfen(boardPart);
  const target = lastMoveUsi ? lastMoveUsi.slice(2, 4) : "";
  const targetFile = target ? Number(target[0]) : 0;
  const targetRank = target ? target.charCodeAt(1) - 96 : 0;

  const cellX = (file: number) => PAD + (flipped ? file - 1 : 9 - file) * CELL;
  const cellY = (rank: number) => PAD + (flipped ? 9 - rank : rank - 1) * CELL;

  return (
    <div className="board-wrap">
      <HandRow hand={handPart} black={flipped} />
      <svg className="board" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="盤面">
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
      </svg>
      <HandRow hand={handPart} black={!flipped} />
      <div className="muted" style={{ textAlign: "center" }}>
        {turn === "b" ? "先手番" : "後手番"}
      </div>
    </div>
  );
}
