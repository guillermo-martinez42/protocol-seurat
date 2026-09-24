export function ulebEncode(v: number): number[] {
  if (!Number.isSafeInteger(v) || v < 0) throw new Error('uleb: expecting non-negative safe int');
  const out: number[] = [];
  do {
    let b = v % 128;
    v = Math.floor(v / 128);
    if (v > 0) b |= 0x80;
    out.push(b);
  } while (v > 0);
  return out;
}

export function ulebDecode(bytes: Uint8Array, pos: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let i = pos;
  for (;;) {
    const b = bytes[i];
    if (b === undefined) throw new Error('uleb: truncated');
    value += (b & 0x7f) * 2 ** shift;
    i += 1;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (shift > 53) throw new Error('uleb: overflow');
  }
  if (!Number.isSafeInteger(value)) throw new Error('uleb: overflow');
  return { value, next: i };
}

export function zigzagEncode(x: number): number {
  if (!Number.isSafeInteger(x)) throw new Error('zigzag: not a safe int');
  return x >= 0 ? x * 2 : -x * 2 - 1;
}

export function zigzagDecode(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('zigzag: bad input');
  return (n & 1) === 0 ? n / 2 : -((n + 1) / 2);
}

export function sLebEncode(x: number): number[] {
  return ulebEncode(zigzagEncode(x));
}

export function sLebDecode(bytes: Uint8Array, pos: number): { value: number; next: number } {
  const r = ulebDecode(bytes, pos);
  return { value: zigzagDecode(r.value), next: r.next };
}
