import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ShareCard, type ShareCardProps } from "./ShareCard";

/** ShareCard を SVG の文字列にする (画面には出さない) */
export function shareCardSvg(props: ShareCardProps): string {
  const host = document.createElement("div");
  const root = createRoot(host);
  flushSync(() => root.render(<ShareCard {...props} />));
  const svg = host.innerHTML;
  root.unmount();
  return svg;
}

/** SVG の文字列を PNG にする。scale は端末の画面でつぶれないように 2 倍 */
export async function svgToPng(svg: string, scale = 2): Promise<Blob> {
  const img = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("画像を作れませんでした"));
  });
  // blob: の SVG は Safari で canvas が汚染扱いになることがあるので data: で読む
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;
  const canvas = document.createElement("canvas");
  canvas.width = img.width * scale;
  canvas.height = img.height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を作れませんでした");
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("画像を作れませんでした"))),
      "image/png",
    ),
  );
}

/** ファイル名は ASCII に寄せる (日本語を含むと保存名が「download」になるブラウザがある) */
export function shareFileName(name: string, date: string): string {
  return `shogi-atlas-${name.replace(/[\\/:*?"<>|\s]+/g, "_")}-${date}.png`;
}
