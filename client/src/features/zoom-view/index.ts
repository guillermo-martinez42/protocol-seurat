import { clamp } from '@/shared/lib/clamp';
import type { ViewState } from './model';

export function zoomTarget(v: ViewState, ns: number, px: number, py: number, minS: number, maxS: number): ViewState {
  const c = clamp(ns, minS, maxS);
  return {
    ...v,
    ts: c,
    ttx: px - (px - v.ttx) * (c / v.ts),
    tty: py - (py - v.tty) * (c / v.ts),
    px, py,
  };
}

export function wheelZoom(ts: number, deltaY: number, mode: number, ctrl: boolean): number {
  const dy = deltaY * (mode === 1 ? 16 : mode === 2 ? 400 : 1);
  return ts * Math.exp(-dy * (ctrl ? 0.01 : 0.0022));
}
