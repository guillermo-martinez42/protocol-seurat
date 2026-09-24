import { clamp } from '@/shared/lib/clamp';

export interface Roi { x0: number; y0: number; x1: number; y1: number }
export interface Viewport { vw: number; vh: number }

export function idealDensity(roi: Roi, vp: Viewport): number {
  const w = Math.max(1, roi.x1 - roi.x0);
  const h = Math.max(1, roi.y1 - roi.y0);
  return Math.log2(Math.max(w / Math.max(1, vp.vw), h / Math.max(1, vp.vh)));
}

export function strataFor(ideal: number, top: number): { s: number; phi: number } {
  if (ideal <= 0) return { s: 0, phi: 0 };
  const s = clamp(Math.floor(ideal), 0, top);
  if (s >= top) return { s: top, phi: 0 };
  return { s, phi: ideal - s };
}

export function bandasFor(phi: number): number {
  return 4 - Math.min(3, Math.floor(phi * 4));
}

export interface Hud {
  pct: number;
  frac: number;
  inDots: boolean;
  dotThreshold: number;
}

export function hudFor(s: number, minS: number, maxS: number, dotsOn: boolean, th: number): Hud {
  const frac = clamp((Math.log(s) - Math.log(minS)) / (Math.log(maxS) - Math.log(minS)), 0, 1);
  return { pct: s * 100, frac, inDots: dotsOn && s >= th, dotThreshold: th };
}

export function viewToRoi(s: number, tx: number, ty: number, vp: Viewport, iw: number, ih: number): Roi {
  return {
    x0: Math.max(0, Math.floor(-tx / s)),
    y0: Math.max(0, Math.floor(-ty / s)),
    x1: Math.min(iw, Math.ceil((vp.vw - tx) / s)),
    y1: Math.min(ih, Math.ceil((vp.vh - ty) / s)),
  };
}
