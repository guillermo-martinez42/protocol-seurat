export function spPredictH(sWest: number, sEast: number): number {
  return (sWest - sEast + 2) >> 2;
}

export function spPredictV(sNorth: number, sSouth: number): number {
  return (sNorth - sSouth + 2) >> 2;
}

export function dequant(i: number, q: number): number {
  if (i === 0) return 0;
  const sign = i > 0 ? 1 : -1;
  return sign * (Math.abs(i) * q + Math.floor(q / 2));
}

export function quant(x: number, q: number): number {
  const m = Math.trunc(x / q);
  return Math.sign(x) * Math.abs(m);
}

export interface ChildBlock {
  a: number;
  b: number;
  c: number;
  d: number;
}

export function inverseBlock(s: number, h: number, v: number, d: number): ChildBlock {
  const l1 = s + ((v + 1) >> 1);
  const l2 = l1 - v;
  const h1 = h + ((d + 1) >> 1);
  const h2 = h1 - d;
  const a = l1 + ((h1 + 1) >> 1);
  const b = a - h1;
  const c = l2 + ((h2 + 1) >> 1);
  const dd = c - h2;
  return { a, b, c, d: dd };
}

export function forwardBlock(a: number, b: number, c: number, d: number): { s: number; h: number; v: number; dv: number } {
  const l1 = (a + b) >> 1;
  const h1 = a - b;
  const l2 = (c + d) >> 1;
  const h2 = c - d;
  return { s: (l1 + l2) >> 1, h: (h1 + h2) >> 1, v: l1 - l2, dv: h1 - h2 };
}
