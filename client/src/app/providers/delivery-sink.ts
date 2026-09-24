import { RECIBO_BATCH, RECIBO_FLUSH_MS, SOLTAR_BATCH_MS } from '@/shared/config/constants';
import { parseBrushHead, splitBrushId, sliceBands, verifyBand } from '@/shared/proto/brush';
import { rangesDecode } from '@/shared/proto/ranges';
import { viDecode } from '@/shared/proto/varint';
import type { Scrape } from '@/shared/proto/messages';
import { emptyLedger, ownedBytes, ownedDeliveries, type DeliveryLedger, type DeliveryRecord } from '@/entities/delivery/store';
import type { SynthRequest } from '@/workers/protocol';
import type { SessionClient } from './session-client';

interface PendingScrape {
  order: number;
  epoch: number;
  through: number;
  predicate: number;
  params: Uint8Array;
}

export class DeliverySink {
  book: DeliveryLedger = emptyLedger();
  renewThrough = 0;
  private worker: Worker | null = null;
  private receiptTimer = 0;
  private releaseTimer = 0;
  private expiredQueue: number[] = [];
  private queueMs = 0;
  private scrapes: PendingScrape[] = [];
  private cancelled = new Set<number>();
  private settledBelow: number | null = null;

  constructor(
    public readonly handle: number,
    private client: () => SessionClient | null,
    private maxKiB: () => number,
    private maxBrushes: () => number,
    public semillaAncho = 192,
    public semillaAlto = 160,
  ) {}

  private ensureWorker(onBitmap: (delivery: number, bmp: ImageBitmap, ms: number) => void): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('../../workers/synthesis.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent) => {
      const out = ev.data as { delivery: number; ok: boolean; error?: string; rgba: ArrayBuffer | null; width: number; height: number; elapsedMs: number };
      const t0 = performance.now();
      void t0;
      if (!out.ok || !out.rgba) {
        this.release([out.delivery], 2);
        return;
      }
      createImageBitmap(new ImageData(new Uint8ClampedArray(out.rgba), out.width, out.height))
        .then((bmp) => {
          const rec = this.book.byDelivery.get(out.delivery);
          if (rec) {
            rec.rgba = bmp;
            this.book.pendingReceipt.push(out.delivery);
            this.queueMs = Math.max(0, this.queueMs - out.elapsedMs);
            onBitmap(out.delivery, bmp, out.elapsedMs);
            this.maybeFlushRecibo();
          } else {
            bmp.close();
          }
        })
        .catch(() => this.release([out.delivery], 2));
    };
    this.worker = w;
    return w;
  }

  ingest(
    bytes: Uint8Array,
    now: () => number,
    onPaint: () => void,
    leaseS: number,
  ): void {
    let h;
    try {
      h = parseBrushHead(bytes);
    } catch {
      return;
    }
    if (h.handle !== this.handle) return;
    if (this.settledBelow !== null && h.delivery <= this.settledBelow) {
      const probe: DeliveryRecord = {
        delivery: h.delivery, brushId: h.brushId, stratum: Number((h.brushId >> 56n) & 0xffn),
        from: h.from, through: h.through, bytes: 0, epoch: h.epoch, edition: h.edition, expires: 0, rgba: null,
      };
      if (this.scrapes.some((p) => h.delivery <= p.through && this.matchesScrape(probe, p.predicate, p.params))) return;
    }
    if (this.cancelled.has(h.delivery)) return;
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
        this.release([h.delivery], 6);
        return;
      }
    }
    const total = bands.reduce((n, b) => n + b.length, 0);
    const split = splitBrushId(h.brushId);
    const rec: DeliveryRecord = {
      delivery: h.delivery,
      brushId: h.brushId,
      stratum: split.stratum,
      from: h.from,
      through: h.through,
      bytes: total,
      epoch: h.epoch,
      edition: h.edition,
      expires: now() + leaseS * 1000,
      rgba: null,
    };
    this.book.byDelivery.set(h.delivery, rec);
    this.book.inFlight.add(h.delivery);
    const transfer: ArrayBuffer[] = bands.map((b) => {
      const ab = new ArrayBuffer(b.length);
      new Uint8Array(ab).set(b);
      return ab;
    });
    const req: SynthRequest = {
      delivery: h.delivery,
      stratum: split.stratum,
      qY: h.qY,
      qC: h.qC,
      seed: split.stratum === 10,
      semillaAncho: this.semillaAncho,
      semillaAlto: this.semillaAlto,
      bands: transfer,
    };
    try {
      this.ensureWorker(() => onPaint()).postMessage(req, { transfer: [...transfer] });
      this.queueMs += 5;
    } catch {
      this.release([h.delivery], 2);
    }
  }

  applyPlanCanceladas(ranges: number[]): void {
    for (const n of ranges) {
      this.cancelled.add(n);
      this.book.byDelivery.delete(n);
      this.book.inFlight.delete(n);
    }
  }

  applyRaspar(r: Scrape, now: () => number): void {
    void now;
    this.scrapes.push({ order: r.order, epoch: r.epoch, through: r.through, predicate: r.predicate, params: r.params });
    let raspadas = 0;
    let kib = 0;
    for (const [n, rec] of [...this.book.byDelivery]) {
      if (n > r.through) continue;
      if (this.matchesScrape(rec, r.predicate, r.params)) {
        rec.rgba?.close();
        kib += Math.ceil(rec.bytes / 1024);
        raspadas += 1;
        this.book.byDelivery.delete(n);
        this.book.inFlight.delete(n);
      }
    }
    this.flushSoltar();
    const keep = ownedDeliveries(this.book).filter((n) => n <= r.through);
    this.client()?.sendRaspado(this.handle, r.order, r.epoch, r.through, raspadas, kib, keep);
    this.settledBelow = this.settledBelow === null ? r.through : Math.max(this.settledBelow, r.through);
    this.scrapes = this.scrapes.filter((p) => p.through > r.through);
  }

  applyRenovar(ranges: number[], order: number, leaseS: number, now: () => number): void {
    this.renewThrough = Math.max(this.renewThrough, order);
    const t = now() + leaseS * 1000;
    for (const n of ranges) {
      const rec = this.book.byDelivery.get(n);
      if (rec) rec.expires = t;
    }
    this.flushRecibo();
  }

  inventory(through: number): { brushCount: number; kib: number; ranges: number[] } {
    const ranges = ownedDeliveries(this.book).filter((n) => n <= through);
    return { brushCount: new Set([...this.book.byDelivery.values()].map((r) => r.brushId.toString())).size, kib: Math.ceil(ownedBytes(this.book) / 1024), ranges };
  }

  sweepExpiry(now: () => number): void {
    const t = now();
    for (const [n, rec] of this.book.byDelivery) {
      if (rec.expires <= t) {
        rec.rgba?.close();
        this.book.byDelivery.delete(n);
        this.book.inFlight.delete(n);
        this.expiredQueue.push(n);
      }
    }
    if (this.expiredQueue.length > 0 && this.releaseTimer === 0) {
      this.releaseTimer = setTimeout(() => {
        this.releaseTimer = 0;
        const q = this.expiredQueue;
        this.expiredQueue = [];
        this.release(q, 3);
      }, SOLTAR_BATCH_MS) as unknown as number;
    }
  }

  voluntaryEvict(centerX: number, centerY: number, inCone: (id: bigint) => boolean): void {
    const owned = ownedDeliveries(this.book);
    if (owned.length + this.book.inFlight.size < this.maxBrushes() - 8 && ownedBytes(this.book) <= this.maxKiB() * 0.9) return;
    const childCount = new Map<string, number>();
    for (const rec of this.book.byDelivery.values()) {
      const p = parentKey(rec.brushId, rec.stratum);
      childCount.set(p, (childCount.get(p) ?? 0) + 1);
    }
    const leaves = [...this.book.byDelivery.values()].filter(
      (r) => (childCount.get(r.brushId.toString()) ?? 0) === 0 && r.stratum < 7 && !inCone(r.brushId),
    );
    leaves.sort((a, b) => b.stratum - a.stratum || distScore(b, centerX, centerY) - distScore(a, centerX, centerY));
    const drop = leaves.slice(0, Math.max(1, Math.floor(leaves.length / 4)));
    const nums = drop.map((r) => r.delivery);
    for (const r of drop) {
      r.rgba?.close();
      this.book.byDelivery.delete(r.delivery);
    }
    this.release(nums, 1);
  }

  libre(): number {
    return Math.max(0, this.maxBrushes() - this.book.byDelivery.size);
  }

  private release(ranges: number[], reason: number): void {
    if (ranges.length === 0) return;
    this.client()?.sendSoltar(this.handle, reason, [...ranges].sort((a, b) => a - b));
  }

  private flushSoltar(): void {
    void 0;
  }

  private maybeFlushRecibo(): void {
    if (this.book.pendingReceipt.length >= RECIBO_BATCH) {
      this.flushRecibo();
      return;
    }
    if (this.receiptTimer === 0 && this.book.pendingReceipt.length > 0) {
      this.receiptTimer = setTimeout(() => {
        this.receiptTimer = 0;
        this.flushRecibo();
      }, RECIBO_FLUSH_MS) as unknown as number;
    }
  }

  private flushRecibo(): void {
    const q = this.book.pendingReceipt;
    this.book.pendingReceipt = [];
    if (q.length === 0 && this.renewThrough === 0) return;
    for (const n of q) this.book.inFlight.delete(n);
    this.client()?.sendRecibo(this.handle, [...q].sort((a, b) => a - b), Math.round(this.queueMs), this.libre(), this.renewThrough);
  }

  matchesScrape(rec: DeliveryRecord, predicate: number, params: Uint8Array): boolean {
    switch (predicate) {
      case 5:
        return true;
      case 1: {
        const stratum = params[0] ?? 0;
        return rec.stratum < stratum;
      }
      case 3: {
        const stratum = params[0] ?? 0;
        const bandasMax = params[1] ?? 0;
        return rec.stratum === stratum && rec.through > bandasMax;
      }
      case 4: {
        try {
          return listaContains(params, rec.delivery);
        } catch {
          return false;
        }
      }
      case 2: {
        try {
          if (rec.stratum >= 7) return false;
          let p = 0;
          let r = viDecode(params, p); const x0 = r.value; p = r.next;
          r = viDecode(params, p); const y0 = r.value; p = r.next;
          r = viDecode(params, p); const x1 = r.value; p = r.next;
          r = viDecode(params, p); const y1 = r.value;
          const { stratum, bx, by } = splitBrushId(rec.brushId);
          const size = 256 * (2 ** stratum);
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
    clearTimeout(this.receiptTimer);
    clearTimeout(this.releaseTimer);
    this.worker?.terminate();
    this.worker = null;
    for (const rec of this.book.byDelivery.values()) rec.rgba?.close();
    this.book = emptyLedger();
  }
}

function parentKey(id: bigint, s: number): string {
  void s;
  return ((id >> 2n) | (BigInt(s + 1) << 56n)).toString();
}

function distScore(r: DeliveryRecord, cx: number, cy: number): number {
  void r;
  void cx;
  void cy;
  return 0;
}

function listaContains(params: Uint8Array, delivery: number): boolean {
  const r = rangesDecode(params, 0);
  return r.values.includes(delivery);
}
