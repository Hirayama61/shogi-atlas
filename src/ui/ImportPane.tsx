import { useState } from "react";
import { parseKifu, splitKifuBlocks } from "../core/parse";
import type { GameRecord } from "../core/types";
import { upsertGames } from "../db/db";
import { describeGame } from "./labels";

interface Props {
  onImported: () => void;
}

export function ImportPane({ onImported }: Props) {
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [memo, setMemo] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState<GameRecord[]>([]);

  const run = async () => {
    setBusy(true);
    setErrors([]);
    setDone([]);
    const blocks = splitKifuBlocks(text);
    const games: GameRecord[] = [];
    const errs: string[] = [];
    const tagList = tags.split(/[,、\s]+/).filter(Boolean);
    for (const [i, block] of blocks.entries()) {
      try {
        games.push(
          await parseKifu(block, {
            source: url.trim() ? { kind: "url", url: url.trim() } : { kind: "paste" },
            tags: tagList,
            memo,
          }),
        );
      } catch (e) {
        errs.push(`${i + 1} 件目: ${(e as Error).message}`);
      }
    }
    if (games.length) await upsertGames(games);
    setDone(games);
    setErrors(errs);
    setBusy(false);
    if (games.length && !errs.length) {
      setText("");
      setUrl("");
    }
  };

  return (
    <section className="panel">
      <div className="field">
        <label>棋譜 (KIF / KI2 / CSA / USI)。複数ある場合は「---」の行で区切る</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="将棋ウォーズの「棋譜コピー」をそのまま貼り付け"
        />
      </div>
      <div className="field">
        <label>出典 URL (任意)</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
      </div>
      <div className="field">
        <label>タグ (カンマ区切り。例: 大会相手, 〇〇さん)</label>
        <input value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>
      <div className="field">
        <label>メモ (任意)</label>
        <input value={memo} onChange={(e) => setMemo(e.target.value)} />
      </div>
      <div className="row">
        <button className="primary" disabled={busy || !text.trim()} onClick={run}>
          取り込む
        </button>
        {done.length > 0 && (
          <button className="ghost" onClick={onImported}>
            一覧へ
          </button>
        )}
        <span className="muted">この端末のブラウザにだけ保存されます</span>
      </div>
      {errors.map((e) => (
        <p key={e} className="error">
          {e}
        </p>
      ))}
      {done.map((g) => (
        <p key={g.id}>
          ✓ ☗{g.black} vs ☖{g.white} — {describeGame(g)}
        </p>
      ))}
    </section>
  );
}
