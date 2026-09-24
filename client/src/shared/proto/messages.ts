import { concat, strDecode, strEncode, u64Decode, u64Encode, viDecode, viEncode } from './varint';
import { rangesDecode, rangesEncode } from './ranges';
import { parseTlvs, tlvEncode } from './frame';

export const T = {
  SALUDO: 0x01, BIENVENIDA: 0x02, LATIDO: 0x03, ECO: 0x04, ERROR: 0x05, ADIOS: 0x06,
  CATALOGO: 0x10, OBRA: 0x11, ABRIR: 0x12, ABIERTA: 0x13, CERRAR: 0x14,
  MIRADA: 0x20, CONCESION: 0x21, PLAN: 0x23, RASPAR: 0x24, RASPADO: 0x25,
  RECIBO: 0x26, SOLTAR: 0x27, RENOVAR: 0x28, AUDITAR: 0x2a, INVENTARIO: 0x2b,
} as const;

export const CAP_DATAGRAMAS = 0x01;
export const CAP_REANUDAR = 0x02;

export interface ReanudarClaim { handle: number; ranges: number[] }
export interface Saludo {
  verMin: number; verMax: number; caps: number; memMib: number; token: Uint8Array;
  resume?: { sesionAnterior: bigint; ticket: Uint8Array; claims: ReanudarClaim[] };
}
export interface Bienvenida {
  version: number; caps: number; sessionId: bigint; lado: number; leaseS: number;
  latidoS: number; maxEnVuelo: number; sesionMaxPinceladas: number;
  ticket: Uint8Array; resumed: number[];
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export { hexToBytes };

export function saludoCore(s: Saludo): Uint8Array {
  return concat(
    viEncode(s.verMin), viEncode(s.verMax), viEncode(s.caps), viEncode(s.memMib),
    viEncode(s.token.length), s.token,
  );
}

export function saludoTlvs(s: Saludo): Uint8Array[] {
  if (!s.resume) return [];
  const parts: Array<number[] | Uint8Array> = [
    u64Encode(s.resume.sesionAnterior),
    s.resume.ticket,
    viEncode(s.resume.claims.length),
  ];
  for (const c of s.resume.claims) parts.push(viEncode(c.handle), rangesEncode(c.ranges));
  return [tlvEncode(0x01, concat(...parts))];
}

export function saludoDecode(payload: Uint8Array): Saludo {
  let p = 0;
  let r = viDecode(payload, p); const verMin = r.value; p = r.next;
  r = viDecode(payload, p); const verMax = r.value; p = r.next;
  r = viDecode(payload, p); const caps = r.value; p = r.next;
  r = viDecode(payload, p); const memMib = r.value; p = r.next;
  r = viDecode(payload, p); const tokenLen = r.value; p = r.next;
  const token = payload.slice(p, p + tokenLen); p += tokenLen;
  const out: Saludo = { verMin, verMax, caps, memMib, token };
  for (const t of parseTlvs(payload.slice(p))) {
    if (t.tag !== 0x01) continue;
    let q = 0;
    const s64 = u64Decode(t.value, q); q = s64.next;
    const ticket = t.value.slice(q, q + 32); q += 32;
    const n = viDecode(t.value, q); q = n.next;
    const claims: ReanudarClaim[] = [];
    for (let i = 0; i < n.value; i++) {
      const h = viDecode(t.value, q); q = h.next;
      const rr = rangesDecode(t.value, q); q = rr.next;
      claims.push({ handle: h.value, ranges: rr.values });
    }
    out.resume = { sesionAnterior: s64.value, ticket, claims };
  }
  return out;
}

export function bienvenidaCore(b: Bienvenida): Uint8Array {
  return concat(
    viEncode(b.version), viEncode(b.caps), u64Encode(b.sessionId), viEncode(b.lado),
    viEncode(b.leaseS), viEncode(b.latidoS), viEncode(b.maxEnVuelo),
    viEncode(b.sesionMaxPinceladas),
  );
}

export function bienvenidaTlvs(b: Bienvenida): Uint8Array[] {
  const out = [tlvEncode(0x02, b.ticket)];
  if (b.resumed.length > 0) {
    out.push(tlvEncode(0x03, concat(viEncode(b.resumed.length), ...b.resumed.map((h) => viEncode(h)))));
  }
  return out;
}

export function bienvenidaDecode(payload: Uint8Array): Bienvenida {
  let p = 0;
  let r = viDecode(payload, p); const version = r.value; p = r.next;
  r = viDecode(payload, p); const caps = r.value; p = r.next;
  const sid = u64Decode(payload, p); p = sid.next;
  r = viDecode(payload, p); const lado = r.value; p = r.next;
  r = viDecode(payload, p); const leaseS = r.value; p = r.next;
  r = viDecode(payload, p); const latidoS = r.value; p = r.next;
  r = viDecode(payload, p); const maxEnVuelo = r.value; p = r.next;
  r = viDecode(payload, p); const sesionMaxPinceladas = r.value; p = r.next;
  const out: Bienvenida = {
    version, caps, sessionId: sid.value, lado, leaseS, latidoS,
    maxEnVuelo, sesionMaxPinceladas, ticket: new Uint8Array(0), resumed: [],
  };
  for (const t of parseTlvs(payload.slice(p))) {
    if (t.tag === 0x02) out.ticket = t.value;
    else if (t.tag === 0x03) {
      let q = 0;
      const n = viDecode(t.value, q); q = n.next;
      for (let i = 0; i < n.value; i++) {
        const h = viDecode(t.value, q); q = h.next;
        out.resumed.push(h.value);
      }
    }
  }
  return out;
}

export function latidoCore(nonce: bigint): Uint8Array {
  return Uint8Array.from(u64Encode(nonce));
}
export function latidoDecode(payload: Uint8Array): bigint {
  return u64Decode(payload, 0).value;
}
export function ecoCore(nonce: bigint): Uint8Array {
  return Uint8Array.from(u64Encode(nonce));
}
export function ecoDecode(payload: Uint8Array): bigint {
  return u64Decode(payload, 0).value;
}

export interface ProtoError { codigo: number; fatal: number; refTipo: number; msg: string }
export function errorCore(e: ProtoError): Uint8Array {
  return concat(viEncode(e.codigo), [e.fatal], viEncode(e.refTipo), strEncode(e.msg));
}
export function errorDecode(payload: Uint8Array): ProtoError {
  let p = 0;
  let r = viDecode(payload, p); const codigo = r.value; p = r.next;
  const fatal = payload[p] ?? 0; p += 1;
  r = viDecode(payload, p); const refTipo = r.value; p = r.next;
  const s = strDecode(payload, p);
  return { codigo, fatal, refTipo, msg: s.value };
}

export interface Adios { codigo: number; msg: string }
export function adiosCore(a: Adios): Uint8Array {
  return concat(viEncode(a.codigo), strEncode(a.msg));
}
export function adiosDecode(payload: Uint8Array): Adios {
  const c = viDecode(payload, 0);
  const s = strDecode(payload, c.next);
  return { codigo: c.value, msg: s.value };
}

export interface WorkMsg {
  event: number; estado: number; progreso: number; edition: number;
  width: number; height: number; estratos: number; id: string; name: string;
}
export function obraCore(o: WorkMsg): Uint8Array {
  return concat(
    [o.event, o.estado, o.progreso], viEncode(o.edition), viEncode(o.width),
    viEncode(o.height), [o.estratos], strEncode(o.id), strEncode(o.name),
  );
}
export function obraDecode(payload: Uint8Array): WorkMsg {
  let p = 0;
  const event = payload[p] ?? 0; const estado = payload[p + 1] ?? 0; const progreso = payload[p + 2] ?? 0; p += 3;
  let r = viDecode(payload, p); const edition = r.value; p = r.next;
  r = viDecode(payload, p); const width = r.value; p = r.next;
  r = viDecode(payload, p); const height = r.value; p = r.next;
  const estratos = payload[p] ?? 0; p += 1;
  const id = strDecode(payload, p); p = id.next;
  const name = strDecode(payload, p);
  return { event, estado, progreso, edition, width, height, estratos, id: id.value, name: name.value };
}

export function abrirCore(id: string): Uint8Array {
  return strEncode(id);
}
export function abrirDecode(payload: Uint8Array): string {
  return strDecode(payload, 0).value;
}

export interface Abierta {
  handle: number; width: number; height: number; estratos: number; edition: number;
  techoEstrato: number; techoBandas: number; semillaAncho: number; semillaAlto: number;
}
export function abiertaCore(a: Abierta): Uint8Array {
  return concat(
    viEncode(a.handle), viEncode(a.width), viEncode(a.height), [a.estratos],
    viEncode(a.edition), [a.techoEstrato, a.techoBandas],
    viEncode(a.semillaAncho), viEncode(a.semillaAlto),
  );
}
export function abiertaDecode(payload: Uint8Array): Abierta {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const width = r.value; p = r.next;
  r = viDecode(payload, p); const height = r.value; p = r.next;
  const estratos = payload[p] ?? 0; p += 1;
  r = viDecode(payload, p); const edition = r.value; p = r.next;
  const techoEstrato = payload[p] ?? 0; const techoBandas = payload[p + 1] ?? 0; p += 2;
  r = viDecode(payload, p); const semillaAncho = r.value; p = r.next;
  r = viDecode(payload, p); const semillaAlto = r.value; p = r.next;
  return { handle, width, height, estratos, edition, techoEstrato, techoBandas, semillaAncho, semillaAlto };
}

export interface Gaze {
  handle: number; seq: number; x0: number; y0: number; x1: number; y1: number;
  vw: number; vh: number; mflags: number;
}
export function gazeCore(m: Gaze): Uint8Array {
  return concat(
    viEncode(m.handle), viEncode(m.seq), viEncode(m.x0), viEncode(m.y0),
    viEncode(m.x1), viEncode(m.y1), viEncode(m.vw), viEncode(m.vh), [m.mflags],
  );
}
export function gazeDecode(payload: Uint8Array): Gaze {
  let p = 0;
  const vals: number[] = [];
  for (let i = 0; i < 8; i++) {
    const r = viDecode(payload, p);
    vals.push(r.value);
    p = r.next;
  }
  return {
    handle: vals[0] ?? 0, seq: vals[1] ?? 0, x0: vals[2] ?? 0, y0: vals[3] ?? 0,
    x1: vals[4] ?? 0, y1: vals[5] ?? 0, vw: vals[6] ?? 0, vh: vals[7] ?? 0,
    mflags: payload[p] ?? 0,
  };
}

export interface Concession {
  handle: number; epoch: number; estratoMin: number; bandasMax: number; reason: number;
  maxBrushes: number; maxKiB: number; leaseS: number;
}
export function concesionCore(c: Concession): Uint8Array {
  return concat(
    viEncode(c.handle), viEncode(c.epoch), [c.estratoMin, c.bandasMax, c.reason],
    viEncode(c.maxBrushes), viEncode(c.maxKiB), viEncode(c.leaseS),
  );
}
export function concesionDecode(payload: Uint8Array): Concession {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const epoch = r.value; p = r.next;
  const estratoMin = payload[p] ?? 0; const bandasMax = payload[p + 1] ?? 0; const reason = payload[p + 2] ?? 0; p += 3;
  r = viDecode(payload, p); const maxBrushes = r.value; p = r.next;
  r = viDecode(payload, p); const maxKiB = r.value; p = r.next;
  r = viDecode(payload, p); const leaseS = r.value; p = r.next;
  return { handle, epoch, estratoMin, bandasMax, reason, maxBrushes, maxKiB, leaseS };
}

export type PlanMsg =
  | { handle: number; gazeSeq: number; event: 0; first: number; expectedCount: number; throttle: number }
  | { handle: number; gazeSeq: number; event: 1; last: number }
  | { handle: number; gazeSeq: number; event: 2; cancelled: number[] };
export function planCore(p: PlanMsg): Uint8Array {
  const head = concat(viEncode(p.handle), viEncode(p.gazeSeq), [p.event]);
  if (p.event === 0) return concat(head, viEncode(p.first), viEncode(p.expectedCount), [p.throttle]);
  if (p.event === 1) return concat(head, viEncode(p.last));
  return concat(head, rangesEncode(p.cancelled));
}
export function planDecode(payload: Uint8Array): PlanMsg {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const gazeSeq = r.value; p = r.next;
  const event = payload[p] ?? 0; p += 1;
  if (event === 0) {
    r = viDecode(payload, p); const first = r.value; p = r.next;
    r = viDecode(payload, p); const expectedCount = r.value; p = r.next;
    return { handle, gazeSeq, event, first, expectedCount, throttle: payload[p] ?? 0 };
  }
  if (event === 1) {
    r = viDecode(payload, p);
    return { handle, gazeSeq, event, last: r.value };
  }
  const rr = rangesDecode(payload, p);
  return { handle, gazeSeq, event: 2, cancelled: rr.values };
}

export interface Scrape { handle: number; order: number; epoch: number; through: number; predicate: number; params: Uint8Array }
export function scrapeCore(r: Scrape): Uint8Array {
  return concat(viEncode(r.handle), viEncode(r.order), viEncode(r.epoch), viEncode(r.through), [r.predicate], r.params);
}
export function scrapeDecode(payload: Uint8Array): Scrape {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const order = r.value; p = r.next;
  r = viDecode(payload, p); const epoch = r.value; p = r.next;
  r = viDecode(payload, p); const through = r.value; p = r.next;
  const predicate = payload[p] ?? 0; p += 1;
  return { handle, order, epoch, through, predicate, params: payload.slice(p) };
}
export function scrapeParamsLowStratum(stratum: number): Uint8Array {
  return Uint8Array.from([stratum]);
}
export function scrapeParamsOutside(x0: number, y0: number, x1: number, y1: number): Uint8Array {
  return concat(viEncode(x0), viEncode(y0), viEncode(x1), viEncode(y1));
}
export function scrapeParamsBands(stratum: number, bandasMax: number): Uint8Array {
  return Uint8Array.from([stratum, bandasMax]);
}
export function scrapeParamsList(ranges: number[]): Uint8Array {
  return rangesEncode(ranges);
}

export interface Scraped {
  handle: number; order: number; epoch: number; through: number;
  raspadas: number; liberadasKib: number; conservadas: number[];
}
export function scrapedCore(r: Scraped): Uint8Array {
  return concat(
    viEncode(r.handle), viEncode(r.order), viEncode(r.epoch), viEncode(r.through),
    viEncode(r.raspadas), viEncode(r.liberadasKib), rangesEncode(r.conservadas),
  );
}
export function scrapedDecode(payload: Uint8Array): Scraped {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const order = r.value; p = r.next;
  r = viDecode(payload, p); const epoch = r.value; p = r.next;
  r = viDecode(payload, p); const through = r.value; p = r.next;
  r = viDecode(payload, p); const raspadas = r.value; p = r.next;
  r = viDecode(payload, p); const liberadasKib = r.value; p = r.next;
  const rr = rangesDecode(payload, p);
  return { handle, order, epoch, through, raspadas, liberadasKib, conservadas: rr.values };
}

export interface Receipt { handle: number; completed: number[]; queueMs: number; libre: number; renewThrough: number }
export function receiptCore(r: Receipt): Uint8Array {
  return concat(
    viEncode(r.handle), rangesEncode(r.completed), viEncode(r.queueMs),
    viEncode(r.libre), viEncode(r.renewThrough),
  );
}
export function receiptDecode(payload: Uint8Array): Receipt {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  const rr = rangesDecode(payload, p); p = rr.next;
  r = viDecode(payload, p); const queueMs = r.value; p = r.next;
  r = viDecode(payload, p); const libre = r.value; p = r.next;
  r = viDecode(payload, p);
  return { handle, completed: rr.values, queueMs, libre, renewThrough: r.value };
}

export interface Release { handle: number; reason: number; ranges: number[] }
export function releaseCore(s: Release): Uint8Array {
  return concat(viEncode(s.handle), [s.reason], rangesEncode(s.ranges));
}
export function releaseDecode(payload: Uint8Array): Release {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  const reason = payload[p] ?? 0; p += 1;
  const rr = rangesDecode(payload, p);
  return { handle, reason, ranges: rr.values };
}

export interface Renew { handle: number; order: number; leaseS: number; ranges: number[] }
export function renewCore(r: Renew): Uint8Array {
  return concat(viEncode(r.handle), viEncode(r.order), viEncode(r.leaseS), rangesEncode(r.ranges));
}
export function renewDecode(payload: Uint8Array): Renew {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const order = r.value; p = r.next;
  r = viDecode(payload, p); const leaseS = r.value; p = r.next;
  const rr = rangesDecode(payload, p);
  return { handle, order, leaseS, ranges: rr.values };
}

export interface Audit { handle: number; order: number; through: number }
export function auditCore(a: Audit): Uint8Array {
  return concat(viEncode(a.handle), viEncode(a.order), viEncode(a.through));
}
export function auditDecode(payload: Uint8Array): Audit {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const order = r.value; p = r.next;
  r = viDecode(payload, p);
  return { handle, order, through: r.value };
}

export interface Inventory {
  handle: number; order: number; through: number; brushCount: number; kib: number; ranges: number[];
}
export function inventoryCore(v: Inventory): Uint8Array {
  return concat(
    viEncode(v.handle), viEncode(v.order), viEncode(v.through),
    viEncode(v.brushCount), viEncode(v.kib), rangesEncode(v.ranges),
  );
}
export function inventoryDecode(payload: Uint8Array): Inventory {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const order = r.value; p = r.next;
  r = viDecode(payload, p); const through = r.value; p = r.next;
  r = viDecode(payload, p); const brushCount = r.value; p = r.next;
  r = viDecode(payload, p); const kib = r.value; p = r.next;
  const rr = rangesDecode(payload, p);
  return { handle, order, through, brushCount, kib, ranges: rr.values };
}
