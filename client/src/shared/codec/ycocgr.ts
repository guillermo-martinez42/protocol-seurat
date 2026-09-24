export interface YCoCg {
  y: number;
  co: number;
  cg: number;
}

export function rgbToYCoCg(r: number, g: number, b: number): YCoCg {
  const co = r - b;
  const t = b + (co >> 1);
  const cg = g - t;
  const y = t + (cg >> 1);
  return { y, co, cg };
}

export function yCoCgToRgb(y: number, co: number, cg: number): { r: number; g: number; b: number } {
  const t = y - (cg >> 1);
  const g = cg + t;
  const b = t - (co >> 1);
  const r = b + co;
  return { r, g, b };
}
