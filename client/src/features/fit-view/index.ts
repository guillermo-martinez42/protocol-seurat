import type { ViewState } from '../zoom-view/model';

export function fitTarget(v: ViewState, w: number, h: number, iw: number, ih: number): { next: ViewState; fitS: number } {
  const pad = w < 700 ? 16 : 72;
  const top = 88;
  const bot = 168;
  const s = Math.min((w - pad * 2) / iw, (h - top - bot) / ih);
  const ttx = (w - iw * s) / 2;
  const tty = top + (h - top - bot - ih * s) / 2;
  return { next: { ...v, ts: s, ttx, tty, px: w / 2, py: h / 2 }, fitS: s };
}

export function applyFitImmediate(v: ViewState, w: number, h: number, iw: number, ih: number): { next: ViewState; fitS: number } {
  const { next, fitS } = fitTarget(v, w, h, iw, ih);
  return { next: { ...next, s: next.ts, tx: next.ttx, ty: next.tty }, fitS };
}
