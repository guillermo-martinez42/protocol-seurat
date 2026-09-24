import { u32Decode, u64Decode, viDecode } from './varint';
import { crc32c } from '../codec/crc32c';

export const PINCELADA_TIPO = 0x01;

export interface PinceladaHeader {
  handle: number;
  entrega: number;
  pinceladaId: bigint;
  estrato: number;
  desde: number;
  hasta: number;
  epoca: number;
  qY: number;
  qC: number;
  edicion: number;
  crcs: number[];
  largos: number[];
  headerBytes: number;
}

export function pinceladaIdSplit(id: bigint): { s: number; bx: number; by: number } {
  const s = Number((id >> 56n) & 0xffn);
  let morton = id & 0xffffffffffffffn;
  let bx = 0;
  let by = 0;
  for (let i = 0; morton > 0n && i < 28; i++) {
    if ((morton & 1n) !== 0n) bx |= 1 << i;
    if ((morton & 2n) !== 0n) by |= 1 << i;
    morton >>= 2n;
  }
  return { s, bx, by };
}

export function pinceladaIdMake(s: number, bx: number, by: number): bigint {
  let morton = 0n;
  for (let i = 0; i < 28; i++) {
    if ((bx >> i) & 1) morton |= 1n << BigInt(i * 2);
    if ((by >> i) & 1) morton |= 1n << BigInt(i * 2 + 1);
  }
  return (BigInt(s & 0xff) << 56n) | morton;
}

export function parsePinceladaHeader(bytes: Uint8Array): PinceladaHeader {
  let p = 0;
  let r = viDecode(bytes, p);
  if (r.value !== PINCELADA_TIPO) throw new Error('pincelada: bad tipo_flujo');
  p = r.next;
  r = viDecode(bytes, p); const handle = r.value; p = r.next;
  r = viDecode(bytes, p); const entrega = r.value; p = r.next;
  const id = u64Decode(bytes, p); p = id.next;
  const bandas = bytes[p] ?? 0; p += 1;
  const desde = (bandas >> 4) & 0x0f;
  const hasta = bandas & 0x0f;
  r = viDecode(bytes, p); const epoca = r.value; p = r.next;
  const qY = bytes[p] ?? 0; const qC = bytes[p + 1] ?? 0; p += 2;
  r = viDecode(bytes, p); const edicion = r.value; p = r.next;
  const n = hasta - desde;
  if (n <= 0 || n > 4) throw new Error('pincelada: bad bandas');
  const crcs: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = u32Decode(bytes, p);
    crcs.push(c.value);
    p = c.next;
  }
  const largos: number[] = [];
  for (let i = 0; i < n; i++) {
    r = viDecode(bytes, p);
    largos.push(r.value);
    p = r.next;
  }
  return {
    handle, entrega, pinceladaId: id.value, estrato: Number((id.value >> 56n) & 0xffn),
    desde, hasta, epoca, qY, qC, edicion, crcs, largos, headerBytes: p,
  };
}

export function sliceBands(bytes: Uint8Array, h: PinceladaHeader): Uint8Array[] {
  const out: Uint8Array[] = [];
  let p = h.headerBytes;
  for (const len of h.largos) {
    if (p + len > bytes.length) throw new Error('pincelada: truncated band');
    out.push(bytes.slice(p, p + len));
    p += len;
  }
  return out;
}

export function verifyBand(band: Uint8Array, expect: number): boolean {
  return crc32c(band) === (expect >>> 0);
}
