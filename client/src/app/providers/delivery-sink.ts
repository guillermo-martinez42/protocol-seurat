import { RECIBO_BATCH, RECIBO_FLUSH_MS, SOLTAR_BATCH_MS } from '@/shared/config/constants';
import { parsePinceladaHeader, pinceladaIdSplit, sliceBands, verifyBand } from '@/shared/proto/pincelada';
import { rangesDecode } from '@/shared/proto/ranges';
import { viDecode } from '@/shared/proto/varint';
import type { Raspar } from '@/shared/proto/messages';
import { emptyBook, ownedBytes, ownedEntregas, type DeliveryBook, type DeliveryRec } from '@/entities/delivery/store';
import type { SynthRequest } from '@/workers/protocol';
import type { SessionClient } from './session-client';

interface PendingRaspar {
  orden: number;
  epoca: number;
  hasta: number;
  predicado: number;
  params: Uint8Array;
}

export class DeliverySink {
  book: DeliveryBook = emptyBook();
  renovHasta = 0;
  private worker: Worker | null = null;
  private reciboTimer = 0;
  private soltarTimer = 0;
  private expiredQueue: number[] = [];
  private queueMs = 0;
  private raspados: PendingRaspar[] = [];
  private cancelled = new Set<number>();
  private settledBelow: number | null = null;

  constructor(
    private handle: number,
    private client: () => SessionClient | null,
    private maxKib: () => number,
    private maxPinceladas: () => number,
    public semillaAncho = 192,
    public semillaAlto = 160,
  ) {}

  private ensureWorker(onBitmap: (entrega: number, bmp: ImageBitmap, ms: number) => void): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('../../workers/synthesis.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent) => {
      const out = ev.data as { entrega: number; ok: boolean; error?: string; rgba: ArrayBuffer | null; ancho: number; alto: number; elapsedMs: number };
      const t0 = performance.now();
      void t0;
      if (!out.ok || !out.rgba) {
        this.soltar([out.entrega], 2);
        return;
      }
      createImageBitmap(new ImageData(new Uint8ClampedArray(out.rgba), out.ancho, out.alto))
        .then((bmp) => {
          const rec = this.book.byEntrega.get(out.entrega);
          if (rec) {
            rec.rgba = bmp;
            this.book.pendingRecibo.push(out.entrega);
            this.queueMs = Math.max(0, this.queueMs - out.elapsedMs);
            onBitmap(out.entrega, bmp, out.elapsedMs);
            this.maybeFlushRecibo();
          } else {
            bmp.close();
          }
        })
        .catch(() => this.soltar([out.entrega], 2));
    };
    this.worker = w;
    return w;
  }

  ingest(
    bytes: Uint8Array,
    now: () => number,
    onPaint: () => void,
    arriendoS: number,
  ): void {
    let h;
    try {
      h = parsePinceladaHeader(bytes);
    } catch {
      return;
    }
    if (h.handle !== this.handle) return;
    if (this.settledBelow !== null && h.entrega <= this.settledBelow) {
      const probe: DeliveryRec = {
        entrega: h.entrega, pinceladaId: h.pinceladaId, estrato: Number((h.pinceladaId >> 56n) & 0xffn),
        desde: h.desde, hasta: h.hasta, bytes: 0, epoca: h.epoca, edicion: h.edicion, vence: 0, rgba: null,
      };
      if (this.raspados.some((p) => h.entrega <= p.hasta && this.matchesRaspar(probe, p.predicado, p.params))) return;
    }
    if (this.cancelled.has(h.entrega)) return;
    let bands;
    try {
      bands = sliceBands(bytes, h);
    } catch {
      return;
    }
    for (let i = 0; i < bands.length; i++) {
      const band = bands[i];
      const crc = h.crcs[i];
      if (band === undefined || crc === undefined || !verifyBand(band, crc)) {
        this.soltar([h.entrega], 6);
        return;
      }
    }
    const total = bands.reduce((n, b) => n + b.length, 0);
    const split = pinceladaIdSplit(h.pinceladaId);
    const rec: DeliveryRec = {
      entrega: h.entrega,
      pinceladaId: h.pinceladaId,
      estrato: split.s,
      desde: h.desde,
      hasta: h.hasta,
      bytes: total,
      epoca: h.epoca,
      edicion: h.edicion,
      vence: now() + arriendoS * 1000,
      rgba: null,
    };
    this.book.byEntrega.set(h.entrega, rec);
    this.book.inFlight.add(h.entrega);
    const transfer: ArrayBuffer[] = bands.map((b) => {
      const ab = new ArrayBuffer(b.length);
      new Uint8Array(ab).set(b);
      return ab;
    });
    const req: SynthRequest = {
      entrega: h.entrega,
      estrato: split.s,
      qY: h.qY,
      qC: h.qC,
      semilla: split.s === 10,
      semillaAncho: this.semillaAncho,
      semillaAlto: this.semillaAlto,
      bands: transfer,
    };
    try {
      this.ensureWorker(() => onPaint()).postMessage(req, { transfer: [...transfer] });
      this.queueMs += 5;
    } catch {
      this.soltar([h.entrega], 2);
    }
  }

  applyPlanCanceladas(rangos: number[]): void {
    for (const n of rangos) {
      this.cancelled.add(n);
      this.book.byEntrega.delete(n);
      this.book.inFlight.delete(n);
    }
  }

  applyRaspar(r: Raspar, now: () => number): void {
    void now;
    this.raspados.push({ orden: r.orden, epoca: r.epoca, hasta: r.hasta, predicado: r.predicado, params: r.params });
    let raspadas = 0;
    let kib = 0;
    for (const [n, rec] of [...this.book.byEntrega]) {
      if (n > r.hasta) continue;
      if (this.matchesRaspar(rec, r.predicado, r.params)) {
        rec.rgba?.close();
        kib += Math.ceil(rec.bytes / 1024);
        raspadas += 1;
        this.book.byEntrega.delete(n);
        this.book.inFlight.delete(n);
      }
    }
    this.flushSoltar();
    const keep = ownedEntregas(this.book).filter((n) => n <= r.hasta);
    this.client()?.sendRaspado(this.handle, r.orden, r.epoca, r.hasta, raspadas, kib, keep);
    this.settledBelow = this.settledBelow === null ? r.hasta : Math.max(this.settledBelow, r.hasta);
    this.raspados = this.raspados.filter((p) => p.hasta > r.hasta);
  }

  applyRenovar(rangos: number[], orden: number, arriendoS: number, now: () => number): void {
    this.renovHasta = Math.max(this.renovHasta, orden);
    const t = now() + arriendoS * 1000;
    for (const n of rangos) {
      const rec = this.book.byEntrega.get(n);
      if (rec) rec.vence = t;
    }
  }

  inventory(hasta: number): { pinceladas: number; kib: number; rangos: number[] } {
    const rangos = ownedEntregas(this.book).filter((n) => n <= hasta);
    return { pinceladas: new Set([...this.book.byEntrega.values()].map((r) => r.pinceladaId.toString())).size, kib: Math.ceil(ownedBytes(this.book) / 1024), rangos };
  }

  sweepExpiry(now: () => number): void {
    const t = now();
    for (const [n, rec] of this.book.byEntrega) {
      if (rec.vence <= t) {
        rec.rgba?.close();
        this.book.byEntrega.delete(n);
        this.book.inFlight.delete(n);
        this.expiredQueue.push(n);
      }
    }
    if (this.expiredQueue.length > 0 && this.soltarTimer === 0) {
      this.soltarTimer = setTimeout(() => {
        this.soltarTimer = 0;
        const q = this.expiredQueue;
        this.expiredQueue = [];
        this.soltar(q, 3);
      }, SOLTAR_BATCH_MS) as unknown as number;
    }
  }

  voluntaryEvict(centerX: number, centerY: number, inCone: (id: bigint) => boolean): void {
    const owned = ownedEntregas(this.book);
    if (owned.length + this.book.inFlight.size < this.maxPinceladas() - 8 && ownedBytes(this.book) <= this.maxKib() * 0.9) return;
    const childCount = new Map<string, number>();
    for (const rec of this.book.byEntrega.values()) {
      const p = parentKey(rec.pinceladaId, rec.estrato);
      childCount.set(p, (childCount.get(p) ?? 0) + 1);
    }
    const leaves = [...this.book.byEntrega.values()].filter(
      (r) => (childCount.get(r.pinceladaId.toString()) ?? 0) === 0 && r.estrato < 7 && !inCone(r.pinceladaId),
    );
    leaves.sort((a, b) => b.estrato - a.estrato || distScore(b, centerX, centerY) - distScore(a, centerX, centerY));
    const drop = leaves.slice(0, Math.max(1, Math.floor(leaves.length / 4)));
    const nums = drop.map((r) => r.entrega);
    for (const r of drop) {
      r.rgba?.close();
      this.book.byEntrega.delete(r.entrega);
    }
    this.soltar(nums, 1);
  }

  libre(): number {
    return Math.max(0, this.maxPinceladas() - this.book.byEntrega.size);
  }

  private soltar(rangos: number[], motivo: number): void {
    if (rangos.length === 0) return;
    this.client()?.sendSoltar(this.handle, motivo, [...rangos].sort((a, b) => a - b));
  }

  private flushSoltar(): void {
    void 0;
  }

  private maybeFlushRecibo(): void {
    if (this.book.pendingRecibo.length >= RECIBO_BATCH) {
      this.flushRecibo();
      return;
    }
    if (this.reciboTimer === 0 && this.book.pendingRecibo.length > 0) {
      this.reciboTimer = setTimeout(() => {
        this.reciboTimer = 0;
        this.flushRecibo();
      }, RECIBO_FLUSH_MS) as unknown as number;
    }
  }

  private flushRecibo(): void {
    const q = this.book.pendingRecibo;
    this.book.pendingRecibo = [];
    if (q.length === 0) return;
    for (const n of q) this.book.inFlight.delete(n);
    this.client()?.sendRecibo(this.handle, [...q].sort((a, b) => a - b), Math.round(this.queueMs), this.libre(), this.renovHasta);
  }

  matchesRaspar(rec: DeliveryRec, predicado: number, params: Uint8Array): boolean {
    switch (predicado) {
      case 5:
        return true;
      case 1: {
        const estrato = params[0] ?? 0;
        return rec.estrato < estrato;
      }
      case 3: {
        const estrato = params[0] ?? 0;
        const bandasMax = params[1] ?? 0;
        return rec.estrato === estrato && rec.hasta > bandasMax;
      }
      case 4: {
        try {
          return listaContains(params, rec.entrega);
        } catch {
          return false;
        }
      }
      case 2: {
        try {
          if (rec.estrato >= 7) return false;
          let p = 0;
          let r = viDecode(params, p); const x0 = r.value; p = r.next;
          r = viDecode(params, p); const y0 = r.value; p = r.next;
          r = viDecode(params, p); const x1 = r.value; p = r.next;
          r = viDecode(params, p); const y1 = r.value;
          const { s, bx, by } = pinceladaIdSplit(rec.pinceladaId);
          const size = 256 * (2 ** s);
          const px0 = bx * size;
          const py0 = by * size;
          const px1 = px0 + size;
          const py1 = py0 + size;
          const intersects = px0 < x1 && px1 > x0 && py0 < y1 && py1 > y0;
          return !intersects;
        } catch {
          return false;
        }
      }
      default:
        return false;
    }
  }

  dispose(): void {
    clearTimeout(this.reciboTimer);
    clearTimeout(this.soltarTimer);
    this.worker?.terminate();
    this.worker = null;
    for (const rec of this.book.byEntrega.values()) rec.rgba?.close();
    this.book = emptyBook();
  }
}

function parentKey(id: bigint, s: number): string {
  void s;
  return ((id >> 2n) | (BigInt(s + 1) << 56n)).toString();
}

function distScore(r: DeliveryRec, cx: number, cy: number): number {
  void r;
  void cx;
  void cy;
  return 0;
}

function listaContains(params: Uint8Array, entrega: number): boolean {
  const r = rangesDecode(params, 0);
  return r.values.includes(entrega);
}
