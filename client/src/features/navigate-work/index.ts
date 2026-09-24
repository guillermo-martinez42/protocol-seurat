export function stepIndex(idx: number, delta: number, n: number): number {
  if (n <= 0) return 0;
  return (((idx + delta) % n) + n) % n;
}

export function counterLabel(idx: number, n: number): string {
  return idx + 1 + ' / ' + n;
}
