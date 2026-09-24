import { clamp } from './clamp';

export function logFrac(s: number, minS: number, maxS: number): number {
  return clamp((Math.log(s) - Math.log(minS)) / (Math.log(maxS) - Math.log(minS)), 0, 1);
}

export function logUnfrac(f: number, minS: number, maxS: number): number {
  return Math.exp(Math.log(minS) + clamp(f, 0, 1) * (Math.log(maxS) - Math.log(minS)));
}

export function fmtPct(s100: number): string {
  if (s100 < 10) return s100.toFixed(1) + '%';
  return Math.round(s100).toLocaleString('en-US') + '%';
}
