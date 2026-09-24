import type { ViewState } from '../zoom-view/model';

export function panBy(v: ViewState, dx: number, dy: number): ViewState {
  return { ...v, tx: v.tx + dx, ttx: v.ttx + dx, ty: v.ty + dy, tty: v.tty + dy };
}

export function flingTarget(v: ViewState, vx: number, vy: number): ViewState {
  return { ...v, ttx: v.ttx + vx * 170, tty: v.tty + vy * 170 };
}

export function miniPanView(v: ViewState, ix: number, iy: number, w: number, h: number): ViewState {
  return { ...v, ttx: w / 2 - ix * v.ts, tty: h / 2 - iy * v.ts };
}
