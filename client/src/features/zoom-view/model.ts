export interface ViewState {
  s: number; tx: number; ty: number;
  ts: number; ttx: number; tty: number;
  px: number; py: number;
}

export function initialView(): ViewState {
  return { s: 1, tx: 0, ty: 0, ts: 1, ttx: 0, tty: 0, px: 0, py: 0 };
}

export function tickView(v: ViewState): { next: ViewState; moving: boolean } {
  const next = { ...v };
  let moving = false;
  const lr = Math.log(v.ts / v.s);
  if (Math.abs(lr) > 1e-4) {
    const ns = v.s * Math.exp(lr * 0.2);
    next.tx = v.px - (v.px - v.tx) * (ns / v.s);
    next.ty = v.py - (v.py - v.ty) * (ns / v.s);
    next.s = ns;
    moving = true;
  } else if (v.s !== v.ts) {
    next.tx = v.px - (v.px - v.tx) * (v.ts / v.s);
    next.ty = v.py - (v.py - v.ty) * (v.ts / v.s);
    next.s = v.ts;
    moving = true;
  }
  const dx = v.ttx - next.tx;
  const dy = v.tty - next.ty;
  if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
    next.tx += dx * 0.2;
    next.ty += dy * 0.2;
    moving = true;
  } else {
    next.tx = v.ttx;
    next.ty = v.tty;
  }
  return { next, moving };
}
