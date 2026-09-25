import { RECEIPT_EVERY_N, RECEIPT_EVERY_MS, RELEASE_BATCH_MS } from '@/shared/config/constants';
import { receiverWindow } from '@/entities/delivery/credit';
import { makeBrushId, parseBrushHead, splitBrushId, sliceBands, verifyBand } from '@/shared/proto/brush';
import type { Scrape } from '@/shared/proto/messages';
import { matchesScrape as scrapeMatches } from '@/entities/delivery/scrape';
import { effectiveExpiry, emptyLedger, ownedBytes, ownedDeliveries, type DeliveryLedger, type DeliveryRecord } from '@/entities/delivery/store';
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
  private avgDelivery = 0;
  private linkBps = 0;
  private pending = new Map<number, { req: SynthRequest; parentId: bigint; edition: number }>();
  private failed = new Set<number>();
  private nextSynthesisId = 1;
  private activeSynthesis = new Map<number, number>();
  private repaint = (): void => undefined;

  constructor(
    public readonly handle: number,
    private client: () => SessionClient | null,
    private maxKiB: () => number,
    private maxBrushes: () => number,
    public seedWidth = 192,
    public seedHeight = 160,
    public strata = 11,
  ) {}

  get top(): number {
    return Math.max(0, this.strata - 1);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('../../workers/synthesis.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent) => {
      const out = ev.data as { delivery: number; synthesisId: number; ok: boolean; error?: string; rgba: ArrayBuffer | null; planes: ArrayBuffer[] | null; width: number; height: number; elapsedMs: number };
      if (this.activeSynthesis.get(out.delivery) !== out.synthesisId) return;
      if (!out.ok || !out.rgba) {
        this.failSynthesis(out.delivery);
        return;
      }
      createImageBitmap(new ImageData(new Uint8ClampedArray(out.rgba), out.width, out.height))
        .then((bmp) => {
          if (this.activeSynthesis.get(out.delivery) !== out.synthesisId) {
            bmp.close();
            return;
          }
          const rec = this.book.byDelivery.get(out.delivery);
          if (rec) {
            rec.rgba = bmp;
            rec.planes = out.planes;
            rec.pending = false;
            if (!rec.receiptQueued && !rec.receiptSent) {
              rec.receiptQueued = true;
              this.book.pendingReceipt.push(out.delivery);
            }
            this.queueMs = Math.max(0, this.queueMs - out.elapsedMs);
            this.notifyPaint();
            this.resynthesizeChildren(out.delivery);
            this.flushPending();
            this.maybeFlushReceipt();
          } else {
            bmp.close();
          }
        })
        .catch(() => {
          if (this.activeSynthesis.get(out.delivery) === out.synthesisId) this.failSynthesis(out.delivery);
        });
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
    this.repaint = (): void => { onPaint(); };
    let h;
    try {
      h = parseBrushHead(bytes);
    } catch {
      return;
    }
    if (h.handle !== this.handle) return;
    this.failed.delete(h.delivery);
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
    this.avgDelivery = this.avgDelivery === 0 ? bytes.length : 0.8 * this.avgDelivery + 0.2 * bytes.length;
    const split = splitBrushId(h.brushId);
    const retainedBands = bands.map((band) => band.slice().buffer);
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
      bands: retainedBands,
      planes: null,
      qY: h.qY,
      qC: h.qC,
      pending: true,
      receiptQueued: false,
      receiptSent: false,
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
      synthesisId: this.nextSynthesisId++,
      stratum: split.stratum,
      qY: h.qY,
      qC: h.qC,
      seed: split.stratum === 10,
      seedWidth: this.seedWidth,
      seedHeight: this.seedHeight,
      bands: transfer,
    };
    const parent = this.parentFor(split.stratum, split.bx, split.by, h.edition, h.epoch);
    if (parent) this.linkParent(h.delivery, parent.delivery);
    if (parent?.planes) {
      const sourceX = parent.stratum === 10 ? split.bx * 128 : (split.bx & 1) * 128;
      const sourceY = parent.stratum === 10 ? split.by * 128 : (split.by & 1) * 128;
      req.parentPlanes = parent.planes.map((plane) => plane.slice(0));
      req.parentPlaneWidth = parent.stratum === 10 ? this.seedWidth : 256;
      req.parentPlaneHeight = parent.stratum === 10 ? this.seedHeight : 256;
      req.parentX = sourceX;
      req.parentY = sourceY;
    }
    if (split.stratum < 10 && !parent?.planes) {
      const isCoarsest = split.stratum + 1 >= this.top;
      const parentId = isCoarsest
        ? makeBrushId(10, 0, 0)
        : makeBrushId(split.stratum + 1, split.bx >> 1, split.by >> 1);
      this.pending.set(h.delivery, { req, parentId, edition: h.edition });
      return;
    }
    this.dispatch(req);
  }

  private dispatch(req: SynthRequest): void {
    try {
      this.activeSynthesis.set(req.delivery, req.synthesisId);
      const transfers = [...req.bands];
      if (req.parentPlanes) transfers.push(...req.parentPlanes);
      this.ensureWorker().postMessage(req, { transfer: transfers });
      this.queueMs += 5;
    } catch {
      this.failSynthesis(req.delivery);
    }
  }

  private flushPending(): void {
    for (const [delivery, item] of this.pending) {
      const parent = [...this.book.byDelivery.values()].find(
        (r) => r.brushId === item.parentId && r.edition === item.edition && r.epoch <= (this.book.byDelivery.get(delivery)?.epoch ?? r.epoch),
      );
      if (!parent?.planes) continue;
      this.linkParent(delivery, parent.delivery);
      const { bx, by } = splitBrushId(
        this.book.byDelivery.get(delivery)?.brushId ?? 0n,
      );
      item.req.parentPlanes = parent.planes.map((plane) => plane.slice(0));
      item.req.parentPlaneWidth = parent.stratum === 10 ? this.seedWidth : 256;
      item.req.parentPlaneHeight = parent.stratum === 10 ? this.seedHeight : 256;
      item.req.parentX = parent.stratum === 10 ? bx * 128 : (bx & 1) * 128;
      item.req.parentY = parent.stratum === 10 ? by * 128 : (by & 1) * 128;
      this.pending.delete(delivery);
      this.dispatch(item.req);
    }
  }

  private parentFor(stratum: number, bx: number, by: number, edition?: number, epoch?: number): DeliveryRecord | null {
    if (stratum >= 10) return null;
    const isCoarsest = stratum + 1 >= this.top;
    const parentId = isCoarsest
      ? makeBrushId(10, 0, 0)
      : makeBrushId(stratum + 1, bx >> 1, by >> 1);
    return [...this.book.byDelivery.values()]
      .filter((rec) => rec.brushId === parentId && (edition === undefined || rec.edition === edition))
      .filter((rec) => epoch === undefined || rec.epoch <= epoch)
      .sort((a, b) => b.epoch - a.epoch)[0] ?? null;
  }

  private linkParent(child: number, parent: number): void {
    this.book.parentOf.set(child, parent);
    const children = this.book.childrenOf.get(parent) ?? new Set<number>();
    children.add(child);
    this.book.childrenOf.set(parent, children);
    const rec = this.book.byDelivery.get(child);
    if (rec) rec.parentDelivery = parent;
  }

  private unlink(delivery: number): void {
    const parent = this.book.parentOf.get(delivery);
    if (parent !== undefined) this.book.childrenOf.get(parent)?.delete(delivery);
    this.book.parentOf.delete(delivery);
    this.book.childrenOf.delete(delivery);
  }

  private descendants(root: number): number[] {
    const out: number[] = [];
    const visit = (n: number): void => {
      for (const child of this.book.childrenOf.get(n) ?? []) {
        out.push(child);
        visit(child);
      }
    };
    visit(root);
    return out;
  }

  private removeSubtree(root: number, reason: number): number[] {
    const all = [root, ...this.descendants(root)];
    const removed = new Set(all);
    this.book.pendingReceipt = this.book.pendingReceipt.filter((n) => !removed.has(n));
    for (const n of all) {
      this.pending.delete(n);
      const rec = this.book.byDelivery.get(n);
      rec?.rgba?.close();
      this.book.byDelivery.delete(n);
      this.book.inFlight.delete(n);
      this.activeSynthesis.delete(n);
      this.unlink(n);
    }
    if (reason !== 0) this.release(all, reason);
    return all;
  }

  private failSynthesis(delivery: number): void {
    if (this.failed.has(delivery)) return;
    const rec = this.book.byDelivery.get(delivery);
    this.failed.add(delivery);
    if (!rec) return;
    this.book.pendingReceipt = this.book.pendingReceipt.filter((n) => n !== delivery);
    const removed = this.removeSubtree(delivery, 0);
    this.release(removed, 2);
  }

  private resynthesizeChildren(parentDelivery: number): void {
    for (const childId of this.book.childrenOf.get(parentDelivery) ?? []) {
      const child = this.book.byDelivery.get(childId);
      const parent = this.book.byDelivery.get(parentDelivery);
      if (!child || !parent?.planes || !child.bands) continue;
      const { stratum, bx, by } = splitBrushId(child.brushId);
      const req: SynthRequest = {
        delivery: child.delivery, synthesisId: this.nextSynthesisId++, stratum, qY: child.qY ?? 0, qC: child.qC ?? 0,
        seed: stratum === 10, seedWidth: this.seedWidth, seedHeight: this.seedHeight,
        bands: child.bands.map((b) => b.slice(0)),
        parentPlanes: parent.planes.map((p) => p.slice(0)),
        parentPlaneWidth: parent.stratum === 10 ? this.seedWidth : 256,
        parentPlaneHeight: parent.stratum === 10 ? this.seedHeight : 256,
        parentX: parent.stratum === 10 ? bx * 128 : (bx & 1) * 128,
        parentY: parent.stratum === 10 ? by * 128 : (by & 1) * 128,
      };
      child.rgba?.close();
      child.rgba = null;
      child.pending = true;
      this.dispatch(req);
    }
  }

  private notifyPaint(): void {
    this.repaint();
  }

  applyPlanCanceladas(ranges: number[]): void {
    for (const n of ranges) {
      this.cancelled.add(n);
      const brushId = this.book.byDelivery.get(n)?.brushId;
      this.removeSubtree(n, 0);
      if (brushId !== undefined) {
        for (const [delivery, item] of this.pending) {
          if (item.parentId === brushId) this.removeSubtree(delivery, 0);
        }
      }
    }
  }

  applyScrape(r: Scrape, now: () => number): void {
    void now;
    this.scrapes.push({ order: r.order, epoch: r.epoch, through: r.through, predicate: r.predicate, params: r.params });
    let scrapedCount = 0;
    let kib = 0;
    for (const [n, rec] of [...this.book.byDelivery]) {
      if (n > r.through) continue;
      if (this.matchesScrape(rec, r.predicate, r.params)) {
        const subtree = [n, ...this.descendants(n)];
        for (const id of subtree) {
          const child = this.book.byDelivery.get(id);
          if (child) {
            kib += Math.ceil(child.bytes / 1024);
            scrapedCount += 1;
          }
        }
        this.removeSubtree(n, 0);
      }
    }
    this.flushRelease();
    const keep = ownedDeliveries(this.book).filter((n) => n <= r.through);    this.client()?.sendScraped(this.handle, r.order, r.epoch, r.through, scrapedCount, kib, keep);
    this.settledBelow = this.settledBelow === null ? r.through : Math.max(this.settledBelow, r.through);
    this.scrapes = this.scrapes.filter((p) => p.through > r.through);
  }

  applyRenew(ranges: number[], order: number, leaseS: number, now: () => number): void {
    this.renewThrough = Math.max(this.renewThrough, order);
    const t = now() + leaseS * 1000;
    for (const n of ranges) {
      const rec = this.book.byDelivery.get(n);
      if (rec) rec.expires = t;
    }
    this.flushReceipt();
  }

  inventory(through: number): { brushCount: number; kib: number; ranges: number[] } {
    this.flushRelease();
    const ranges = ownedDeliveries(this.book).filter((n) => n <= through);
    return { brushCount: new Set([...this.book.byDelivery.values()].map((r) => r.brushId.toString())).size, kib: Math.ceil(ownedBytes(this.book) / 1024), ranges };
  }

  sweepExpiry(now: () => number): void {
    const t = now();
    const expired = [...this.book.byDelivery.entries()]
      .filter(([, rec]) => this.effectiveExpiry(rec) <= t)
      .map(([n]) => n);
    for (const n of expired) {
      if (!this.book.byDelivery.has(n)) continue;
      const removed = this.removeSubtree(n, 0);
      this.expiredQueue.push(...removed);
    }
    if (this.expiredQueue.length > 0 && this.releaseTimer === 0) {
      this.releaseTimer = setTimeout(() => {
        this.releaseTimer = 0;
        const q = this.expiredQueue;
        this.expiredQueue = [];
        this.release(q, 3);
      }, RELEASE_BATCH_MS) as unknown as number;
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
    const nums: number[] = [];
    for (const r of drop) {
      r.rgba?.close();
      nums.push(...this.removeSubtree(r.delivery, 0));
    }
    this.release(nums, 1);
  }

  /**
   * RECIBO.libre: the memory window, capped to ~CREDIT_WINDOW_S of deliveries at the link's
   * recent rate, so a slow link never queues more than that ahead of a new MIRADA.
   */
  free(): number {
    const memory = Math.max(0, this.maxBrushes() - this.book.byDelivery.size);
    const peak = this.client()?.meter?.peak(performance.now()) ?? 0;
    // Only a second that carried at least one brush measures the link; idle keeps the last rate,
    // so the next view starts with a full window instead of re-ramping from CREDIT_MIN.
    if (this.avgDelivery > 0 && peak >= this.avgDelivery) this.linkBps = peak;
    return receiverWindow(memory, this.linkBps, this.avgDelivery);
  }

  get queueDepthMs(): number {
    return this.queueMs;
  }

  get avgDeliveryBytes(): number {
    return this.avgDelivery;
  }

  private release(ranges: number[], reason: number): void {
    if (ranges.length === 0) return;
    this.client()?.sendRelease(this.handle, reason, [...ranges].sort((a, b) => a - b));
  }

  private effectiveExpiry(rec: DeliveryRecord): number {
    const parentId = this.book.parentOf.get(rec.delivery);
    const parent = parentId === undefined ? null : this.book.byDelivery.get(parentId);
    return effectiveExpiry(rec, parent ? this.effectiveExpiry(parent) : null);
  }

  /** Spec §5.2: SOLTAR must precede anything account-dependent (RASPADO/INVENTARIO). */
  private flushRelease(): void {
    if (this.expiredQueue.length === 0) return;
    if (this.releaseTimer !== 0) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = 0;
    }
    const q = this.expiredQueue;
    this.expiredQueue = [];
    this.release(q, 3);
  }

  private maybeFlushReceipt(): void {
    // A small window (slow link) is refilled per brush so the link never drains; big ones batch.
    if (this.book.pendingReceipt.length >= RECEIPT_EVERY_N || this.free() <= RECEIPT_EVERY_N) {
      this.flushReceipt();
      return;
    }
    if (this.receiptTimer === 0 && this.book.pendingReceipt.length > 0) {
      this.receiptTimer = setTimeout(() => {
        this.receiptTimer = 0;
        this.flushReceipt();
      }, RECEIPT_EVERY_MS) as unknown as number;
    }
  }

  private flushReceipt(): void {
    this.flushRelease();
    const q = this.book.pendingReceipt;
    this.book.pendingReceipt = [];
    if (q.length === 0 && this.renewThrough === 0) return;
    for (const n of q) this.book.inFlight.delete(n);
    for (const n of q) {
      const rec = this.book.byDelivery.get(n);
      if (rec) {
        rec.receiptQueued = false;
        rec.receiptSent = true;
      }
    }
    this.client()?.sendReceipt(this.handle, [...q].sort((a, b) => a - b), Math.round(this.queueMs), this.free(), this.renewThrough);
  }

  matchesScrape(rec: DeliveryRecord, predicate: number, params: Uint8Array): boolean {
    return scrapeMatches(rec, predicate, params);
  }

  dispose(): void {
    clearTimeout(this.receiptTimer);
    clearTimeout(this.releaseTimer);
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    this.activeSynthesis.clear();
    this.failed.clear();
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
