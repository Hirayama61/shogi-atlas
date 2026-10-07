import { useState } from "react";
import type { ShareCardProps } from "./ShareCard";
import { shareCardSvg, shareFileName, svgToPng } from "./shareImage";

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function canShareFile(file: File): boolean {
  return typeof navigator.share === "function" && !!navigator.canShare?.({ files: [file] });
}

function today(): string {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "ready"; file: File; url: string; share: boolean; note?: string }
  | { kind: "error"; message: string };

/**
 * 「画像で共有」ボタン。押すと PNG を作り、共有シートが使えればそれを開き、使えなければダウンロードする。
 * iOS は生成を待つ間にユーザー操作の扱いが切れて共有が拒否されることがあるので、
 * そのときは出来た画像と「共有」ボタンを出して、もう 1 回押してもらう。
 */
export function ShareButton(props: Omit<ShareCardProps, "date">) {
  const [state, setState] = useState<State>({ kind: "idle" });

  const share = async (file: File): Promise<string | undefined> => {
    try {
      await navigator.share({ files: [file], title: `${props.stats.name} 対策` });
      return undefined;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return undefined;
      return "もう一度「共有」を押してください";
    }
  };

  const make = async () => {
    setState({ kind: "busy" });
    try {
      const date = today();
      const blob = await svgToPng(shareCardSvg({ ...props, date }));
      const file = new File([blob], shareFileName(props.stats.name, date), { type: "image/png" });
      const url = URL.createObjectURL(blob);
      const canShare = canShareFile(file);
      setState({ kind: "ready", file, url, share: canShare });
      if (canShare) {
        const note = await share(file);
        if (note) setState({ kind: "ready", file, url, share: true, note });
      } else download(blob, file.name);
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const close = () => {
    if (state.kind === "ready") URL.revokeObjectURL(state.url);
    setState({ kind: "idle" });
  };

  return (
    <div className="share">
      <button
        type="button"
        className="ghost"
        disabled={state.kind === "busy"}
        onClick={() => void make()}
      >
        {state.kind === "busy" ? "画像を作成中…" : "画像で共有"}
      </button>
      {state.kind === "error" && <p className="error">{state.message}</p>}
      {state.kind === "ready" && (
        <div className="share-preview">
          {state.note && <p className="muted">{state.note}</p>}
          <img src={state.url} alt={`${props.stats.name} の対策 1 枚`} />
          <div className="share-actions">
            {state.share && (
              <button type="button" className="primary" onClick={() => void share(state.file)}>
                共有
              </button>
            )}
            <a className="share-save" href={state.url} download={state.file.name}>
              保存
            </a>
            <button type="button" className="ghost" onClick={close}>
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
