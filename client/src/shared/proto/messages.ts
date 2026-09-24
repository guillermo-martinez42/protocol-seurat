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

export interface ReanudarClaim { handle: number; rangos: number[] }
export interface Saludo {
  verMin: number; verMax: number; caps: number; memMib: number; token: Uint8Array;
  reanudar?: { sesionAnterior: bigint; ficha: Uint8Array; claims: ReanudarClaim[] };
}
export interface Bienvenida {
  version: number; caps: number; sesionId: bigint; lado: number; arriendoS: number;
  latidoS: number; maxEnVuelo: number; sesionMaxPinceladas: number;
  ficha: Uint8Array; reanudada: number[];
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
  if (!s.reanudar) return [];
  const parts: Array<number[] | Uint8Array> = [
    u64Encode(s.reanudar.sesionAnterior),
    s.reanudar.ficha,
    viEncode(s.reanudar.claims.length),
  ];
  for (const c of s.reanudar.claims) parts.push(viEncode(c.handle), rangesEncode(c.rangos));
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
    const ficha = t.value.slice(q, q + 32); q += 32;
    const n = viDecode(t.value, q); q = n.next;
    const claims: ReanudarClaim[] = [];
    for (let i = 0; i < n.value; i++) {
      const h = viDecode(t.value, q); q = h.next;
      const rr = rangesDecode(t.value, q); q = rr.next;
      claims.push({ handle: h.value, rangos: rr.values });
    }
    out.reanudar = { sesionAnterior: s64.value, ficha, claims };
  }
  return out;
}

export function bienvenidaCore(b: Bienvenida): Uint8Array {
  return concat(
    viEncode(b.version), viEncode(b.caps), u64Encode(b.sesionId), viEncode(b.lado),
    viEncode(b.arriendoS), viEncode(b.latidoS), viEncode(b.maxEnVuelo),
    viEncode(b.sesionMaxPinceladas),
  );
}

export function bienvenidaTlvs(b: Bienvenida): Uint8Array[] {
  const out = [tlvEncode(0x02, b.ficha)];
  if (b.reanudada.length > 0) {
    out.push(tlvEncode(0x03, concat(viEncode(b.reanudada.length), ...b.reanudada.map((h) => viEncode(h)))));
  }
  return out;
}

export function bienvenidaDecode(payload: Uint8Array): Bienvenida {
  let p = 0;
  let r = viDecode(payload, p); const version = r.value; p = r.next;
  r = viDecode(payload, p); const caps = r.value; p = r.next;
  const sid = u64Decode(payload, p); p = sid.next;
  r = viDecode(payload, p); const lado = r.value; p = r.next;
  r = viDecode(payload, p); const arriendoS = r.value; p = r.next;
  r = viDecode(payload, p); const latidoS = r.value; p = r.next;
  r = viDecode(payload, p); const maxEnVuelo = r.value; p = r.next;
  r = viDecode(payload, p); const sesionMaxPinceladas = r.value; p = r.next;
  const out: Bienvenida = {
    version, caps, sesionId: sid.value, lado, arriendoS, latidoS,
    maxEnVuelo, sesionMaxPinceladas, ficha: new Uint8Array(0), reanudada: [],
  };
  for (const t of parseTlvs(payload.slice(p))) {
    if (t.tag === 0x02) out.ficha = t.value;
    else if (t.tag === 0x03) {
      let q = 0;
      const n = viDecode(t.value, q); q = n.next;
      for (let i = 0; i < n.value; i++) {
        const h = viDecode(t.value, q); q = h.next;
        out.reanudada.push(h.value);
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

export interface ObraMsg {
  evento: number; estado: number; progreso: number; edicion: number;
  ancho: number; alto: number; estratos: number; id: string; nombre: string;
}
export function obraCore(o: ObraMsg): Uint8Array {
  return concat(
    [o.evento, o.estado, o.progreso], viEncode(o.edicion), viEncode(o.ancho),
    viEncode(o.alto), [o.estratos], strEncode(o.id), strEncode(o.nombre),
  );
}
export function obraDecode(payload: Uint8Array): ObraMsg {
  let p = 0;
  const evento = payload[p] ?? 0; const estado = payload[p + 1] ?? 0; const progreso = payload[p + 2] ?? 0; p += 3;
  let r = viDecode(payload, p); const edicion = r.value; p = r.next;
  r = viDecode(payload, p); const ancho = r.value; p = r.next;
  r = viDecode(payload, p); const alto = r.value; p = r.next;
  const estratos = payload[p] ?? 0; p += 1;
  const id = strDecode(payload, p); p = id.next;
  const nombre = strDecode(payload, p);
  return { evento, estado, progreso, edicion, ancho, alto, estratos, id: id.value, nombre: nombre.value };
}

export function abrirCore(id: string): Uint8Array {
  return strEncode(id);
}
export function abrirDecode(payload: Uint8Array): string {
  return strDecode(payload, 0).value;
}

export interface Abierta {
  handle: number; ancho: number; alto: number; estratos: number; edicion: number;
  techoEstrato: number; techoBandas: number; semillaAncho: number; semillaAlto: number;
}
export function abiertaCore(a: Abierta): Uint8Array {
  return concat(
    viEncode(a.handle), viEncode(a.ancho), viEncode(a.alto), [a.estratos],
    viEncode(a.edicion), [a.techoEstrato, a.techoBandas],
    viEncode(a.semillaAncho), viEncode(a.semillaAlto),
  );
}
export function abiertaDecode(payload: Uint8Array): Abierta {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const ancho = r.value; p = r.next;
  r = viDecode(payload, p); const alto = r.value; p = r.next;
  const estratos = payload[p] ?? 0; p += 1;
  r = viDecode(payload, p); const edicion = r.value; p = r.next;
  const techoEstrato = payload[p] ?? 0; const techoBandas = payload[p + 1] ?? 0; p += 2;
  r = viDecode(payload, p); const semillaAncho = r.value; p = r.next;
  r = viDecode(payload, p); const semillaAlto = r.value; p = r.next;
  return { handle, ancho, alto, estratos, edicion, techoEstrato, techoBandas, semillaAncho, semillaAlto };
}

export interface Mirada {
  handle: number; seq: number; x0: number; y0: number; x1: number; y1: number;
  vw: number; vh: number; mflags: number;
}
export function miradaCore(m: Mirada): Uint8Array {
  return concat(
    viEncode(m.handle), viEncode(m.seq), viEncode(m.x0), viEncode(m.y0),
    viEncode(m.x1), viEncode(m.y1), viEncode(m.vw), viEncode(m.vh), [m.mflags],
  );
}
export function miradaDecode(payload: Uint8Array): Mirada {
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

export interface Concesion {
  handle: number; epoca: number; estratoMin: number; bandasMax: number; motivo: number;
  maxPinceladas: number; maxKib: number; arriendoS: number;
}
export function concesionCore(c: Concesion): Uint8Array {
  return concat(
    viEncode(c.handle), viEncode(c.epoca), [c.estratoMin, c.bandasMax, c.motivo],
    viEncode(c.maxPinceladas), viEncode(c.maxKib), viEncode(c.arriendoS),
  );
}
export function concesionDecode(payload: Uint8Array): Concesion {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const epoca = r.value; p = r.next;
  const estratoMin = payload[p] ?? 0; const bandasMax = payload[p + 1] ?? 0; const motivo = payload[p + 2] ?? 0; p += 3;
  r = viDecode(payload, p); const maxPinceladas = r.value; p = r.next;
  r = viDecode(payload, p); const maxKib = r.value; p = r.next;
  r = viDecode(payload, p); const arriendoS = r.value; p = r.next;
  return { handle, epoca, estratoMin, bandasMax, motivo, maxPinceladas, maxKib, arriendoS };
}

export type PlanMsg =
  | { handle: number; seqMirada: number; evento: 0; primera: number; previstas: number; regulacion: number }
  | { handle: number; seqMirada: number; evento: 1; ultima: number }
  | { handle: number; seqMirada: number; evento: 2; canceladas: number[] };
export function planCore(p: PlanMsg): Uint8Array {
  const head = concat(viEncode(p.handle), viEncode(p.seqMirada), [p.evento]);
  if (p.evento === 0) return concat(head, viEncode(p.primera), viEncode(p.previstas), [p.regulacion]);
  if (p.evento === 1) return concat(head, viEncode(p.ultima));
  return concat(head, rangesEncode(p.canceladas));
}
export function planDecode(payload: Uint8Array): PlanMsg {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const seqMirada = r.value; p = r.next;
  const evento = payload[p] ?? 0; p += 1;
  if (evento === 0) {
    r = viDecode(payload, p); const primera = r.value; p = r.next;
    r = viDecode(payload, p); const previstas = r.value; p = r.next;
    return { handle, seqMirada, evento, primera, previstas, regulacion: payload[p] ?? 0 };
  }
  if (evento === 1) {
    r = viDecode(payload, p);
    return { handle, seqMirada, evento, ultima: r.value };
  }
  const rr = rangesDecode(payload, p);
  return { handle, seqMirada, evento: 2, canceladas: rr.values };
}

export interface Raspar { handle: number; orden: number; epoca: number; hasta: number; predicado: number; params: Uint8Array }
export function rasparCore(r: Raspar): Uint8Array {
  return concat(viEncode(r.handle), viEncode(r.orden), viEncode(r.epoca), viEncode(r.hasta), [r.predicado], r.params);
}
export function rasparDecode(payload: Uint8Array): Raspar {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const orden = r.value; p = r.next;
  r = viDecode(payload, p); const epoca = r.value; p = r.next;
  r = viDecode(payload, p); const hasta = r.value; p = r.next;
  const predicado = payload[p] ?? 0; p += 1;
  return { handle, orden, epoca, hasta, predicado, params: payload.slice(p) };
}
export function rasparParamsEstrato(estrato: number): Uint8Array {
  return Uint8Array.from([estrato]);
}
export function rasparParamsFuera(x0: number, y0: number, x1: number, y1: number): Uint8Array {
  return concat(viEncode(x0), viEncode(y0), viEncode(x1), viEncode(y1));
}
export function rasparParamsBandas(estrato: number, bandasMax: number): Uint8Array {
  return Uint8Array.from([estrato, bandasMax]);
}
export function rasparParamsLista(rangos: number[]): Uint8Array {
  return rangesEncode(rangos);
}

export interface Raspado {
  handle: number; orden: number; epoca: number; hasta: number;
  raspadas: number; liberadasKib: number; conservadas: number[];
}
export function raspadoCore(r: Raspado): Uint8Array {
  return concat(
    viEncode(r.handle), viEncode(r.orden), viEncode(r.epoca), viEncode(r.hasta),
    viEncode(r.raspadas), viEncode(r.liberadasKib), rangesEncode(r.conservadas),
  );
}
export function raspadoDecode(payload: Uint8Array): Raspado {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const orden = r.value; p = r.next;
  r = viDecode(payload, p); const epoca = r.value; p = r.next;
  r = viDecode(payload, p); const hasta = r.value; p = r.next;
  r = viDecode(payload, p); const raspadas = r.value; p = r.next;
  r = viDecode(payload, p); const liberadasKib = r.value; p = r.next;
  const rr = rangesDecode(payload, p);
  return { handle, orden, epoca, hasta, raspadas, liberadasKib, conservadas: rr.values };
}

export interface Recibo { handle: number; completadas: number[]; colaMs: number; libre: number; renovHasta: number }
export function reciboCore(r: Recibo): Uint8Array {
  return concat(
    viEncode(r.handle), rangesEncode(r.completadas), viEncode(r.colaMs),
    viEncode(r.libre), viEncode(r.renovHasta),
  );
}
export function reciboDecode(payload: Uint8Array): Recibo {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  const rr = rangesDecode(payload, p); p = rr.next;
  r = viDecode(payload, p); const colaMs = r.value; p = r.next;
  r = viDecode(payload, p); const libre = r.value; p = r.next;
  r = viDecode(payload, p);
  return { handle, completadas: rr.values, colaMs, libre, renovHasta: r.value };
}

export interface Soltar { handle: number; motivo: number; rangos: number[] }
export function soltarCore(s: Soltar): Uint8Array {
  return concat(viEncode(s.handle), [s.motivo], rangesEncode(s.rangos));
}
export function soltarDecode(payload: Uint8Array): Soltar {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  const motivo = payload[p] ?? 0; p += 1;
  const rr = rangesDecode(payload, p);
  return { handle, motivo, rangos: rr.values };
}

export interface Renovar { handle: number; orden: number; arriendoS: number; rangos: number[] }
export function renovarCore(r: Renovar): Uint8Array {
  return concat(viEncode(r.handle), viEncode(r.orden), viEncode(r.arriendoS), rangesEncode(r.rangos));
}
export function renovarDecode(payload: Uint8Array): Renovar {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const orden = r.value; p = r.next;
  r = viDecode(payload, p); const arriendoS = r.value; p = r.next;
  const rr = rangesDecode(payload, p);
  return { handle, orden, arriendoS, rangos: rr.values };
}

export interface Auditar { handle: number; orden: number; hasta: number }
export function auditarCore(a: Auditar): Uint8Array {
  return concat(viEncode(a.handle), viEncode(a.orden), viEncode(a.hasta));
}
export function auditarDecode(payload: Uint8Array): Auditar {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const orden = r.value; p = r.next;
  r = viDecode(payload, p);
  return { handle, orden, hasta: r.value };
}

export interface Inventario {
  handle: number; orden: number; hasta: number; pinceladas: number; kib: number; rangos: number[];
}
export function inventarioCore(v: Inventario): Uint8Array {
  return concat(
    viEncode(v.handle), viEncode(v.orden), viEncode(v.hasta),
    viEncode(v.pinceladas), viEncode(v.kib), rangesEncode(v.rangos),
  );
}
export function inventarioDecode(payload: Uint8Array): Inventario {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const orden = r.value; p = r.next;
  r = viDecode(payload, p); const hasta = r.value; p = r.next;
  r = viDecode(payload, p); const pinceladas = r.value; p = r.next;
  r = viDecode(payload, p); const kib = r.value; p = r.next;
  const rr = rangesDecode(payload, p);
  return { handle, orden, hasta, pinceladas, kib, rangos: rr.values };
}
