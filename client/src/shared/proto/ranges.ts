import { concat, viDecode, viEncode } from './varint';

export function rangesEncode(sorted: number[]): Uint8Array {
  const nums = [...new Set(sorted)].filter((n) => n >= 1).sort((a, b) => a - b);
  if (nums.length === 0) return Uint8Array.from(viEncode(0));
  const mayor = nums[nums.length - 1] ?? 0;
  const gaps: Array<[number, number]> = [];
  let rangeStart = nums[0] ?? mayor;
  let prev = nums[0] ?? mayor;
  for (let i = 1; i < nums.length; i++) {
    const cur = nums[i] ?? prev;
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    gaps.push([prev, cur]);
    rangeStart = cur;
    prev = cur;
  }
  void rangeStart;
  const firstLow = nums[0] ?? mayor;
  const parts: Array<number[] | Uint8Array> = [viEncode(mayor)];
  const ranges: Array<[number, number]> = [];
  let lo = nums[0] ?? mayor;
  let hi = lo;
  for (let i = 1; i <= nums.length; i++) {
    const cur = i < nums.length ? (nums[i] ?? hi) : -1;
    if (cur === hi + 1) {
      hi = cur;
      continue;
    }
    ranges.push([lo, hi]);
    lo = cur;
    hi = cur;
  }
  parts.push(viEncode(ranges.length - 1));
  const top = ranges[ranges.length - 1];
  if (!top) throw new Error('ranges: empty');
  parts.push(viEncode(top[1] - top[0]));
  let prevLow = top[0];
  for (let i = ranges.length - 2; i >= 0; i--) {
    const r = ranges[i];
    if (!r) continue;
    const gap = prevLow - r[1] - 2;
    parts.push(viEncode(gap));
    parts.push(viEncode(r[1] - r[0]));
    prevLow = r[0];
  }
  void firstLow;
  void gaps;
  return concat(...parts);
}

export function rangesDecode(bytes: Uint8Array, pos: number): { values: number[]; next: number } {
  let cur = viDecode(bytes, pos);
  const mayor = cur.value;
  pos = cur.next;
  if (mayor === 0) return { values: [], next: pos };
  cur = viDecode(bytes, pos);
  const nHuecos = cur.value;
  pos = cur.next;
  cur = viDecode(bytes, pos);
  const primer = cur.value;
  pos = cur.next;
  const values: number[] = [];
  let hi = mayor;
  let lo = mayor - primer;
  for (let n = lo; n <= hi; n++) values.push(n);
  let prevLo = lo;
  for (let i = 0; i < nHuecos; i++) {
    cur = viDecode(bytes, pos);
    const hueco = cur.value;
    pos = cur.next;
    cur = viDecode(bytes, pos);
    const largo = cur.value;
    pos = cur.next;
    hi = prevLo - hueco - 2;
    lo = hi - largo;
    for (let n = lo; n <= hi; n++) values.push(n);
    prevLo = lo;
  }
  values.sort((a, b) => a - b);
  return { values, next: pos };
}

export function rangesEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}
