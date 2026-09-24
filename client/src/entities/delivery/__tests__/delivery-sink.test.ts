import { describe, expect, it, vi } from 'vitest';
import { DeliverySink } from '@/app/providers/delivery-sink';
import { crc32c } from '@/shared/codec/crc32c';
import { concat, viEncode } from '@/shared/proto/varint';
import { rangesEncode } from '@/shared/proto/ranges';
import { makeBrushId } from '@/shared/proto/brush';
import type { SessionClient } from '@/app/providers/session-client';

function fakeClient() {
  const sentSoltar: Array<{ handle: number; reason: number; ranges: number[] }> = [];
  const sentRaspado: Array<{ handle: number; order: number; epoch: number; through: number; raspadas: number; liberadasKib: number; conservadas: number[] }> = [];
  const sentRecibo: Array<{ handle: number; completed: number[]; queueMs: number; libre: number; renewThrough: number }> = [];
  const sentInventario: Array<{ handle: number; order: number; through: number; brushCount: number; kib: number; ranges: number[] }> = [];

  const c = {
    sentSoltar,
    sentRaspado,
    sentRecibo,
    sentInventario,
    sendSoltar(handle: number, reason: number, ranges: number[]) {
      sentSoltar.push({ handle, reason, ranges });
    },
    sendRaspado(handle: number, order: number, epoch: number, through: number, raspadas: number, liberadasKib: number, conservadas: number[]) {
      sentRaspado.push({ handle, order, epoch, through, raspadas, liberadasKib, conservadas });
    },
    sendRecibo(handle: number, completed: number[], queueMs: number, libre: number, renewThrough: number) {
      sentRecibo.push({ handle, completed, queueMs, libre, renewThrough });
    },
    sendInventory(handle: number, order: number, through: number, brushCount: number, kib: number, ranges: number[]) {
      sentInventario.push({ handle, order, through, brushCount, kib, ranges });
    },
  };
  return c as unknown as SessionClient & typeof c;
}

function makeDeliveryBytes(opts: {
  handle: number;
  delivery: number;
  brushId: bigint;
  from: number;
  through: number;
  epoch: number;
  qY?: number;
  qC?: number;
  corruptCrc?: boolean;
}): Uint8Array {
  const band = new Uint8Array([10, 20, 30, 40, 50]);
  const bandCrc = crc32c(band);
  const crcVal = opts.corruptCrc ? bandCrc ^ 0xff : bandCrc;

  const bIdBuf = new Uint8Array(8);
  new DataView(bIdBuf.buffer).setBigUint64(0, opts.brushId);

  const crcBuf = new Uint8Array(4);
  new DataView(crcBuf.buffer).setUint32(0, crcVal);

  const head = concat(
    viEncode(0x01),
    viEncode(opts.handle),
    viEncode(opts.delivery),
    bIdBuf,
    new Uint8Array([((opts.from & 0xf) << 4) | (opts.through & 0xf)]),
    viEncode(opts.epoch),
    new Uint8Array([opts.qY ?? 4, opts.qC ?? 6]),
    viEncode(1), // edition
    crcBuf,
    viEncode(band.length),
  );
  return concat(head, band);
}

describe('DeliverySink', () => {
  it('rejects delivery with mismatched CRC and sends SOLTAR reason=6', () => {
    const client = fakeClient();
    const sink = new DeliverySink(1, () => client, () => 36864, () => 768);
    const bytes = makeDeliveryBytes({
      handle: 1,
      delivery: 10,
      brushId: makeBrushId(1, 0, 0),
      from: 0,
      through: 1,
      epoch: 1,
      corruptCrc: true,
    });
    sink.ingest(bytes, () => 1000, () => {}, 120);
    expect(sink.book.byDelivery.size).toBe(0);
    expect(client.sentSoltar).toEqual([{ handle: 1, reason: 6, ranges: [10] }]);
    sink.dispose();
  });

  it('matchesScrape evaluates all 5 protocol predicates', () => {
    const client = fakeClient();
    const sink = new DeliverySink(1, () => client, () => 36864, () => 768);

    const recE1 = {
      delivery: 5, brushId: makeBrushId(1, 0, 0), stratum: 1,
      from: 0, through: 2, bytes: 1024, epoch: 1, edition: 1, expires: 5000, rgba: null,
    };
    const recE8 = {
      delivery: 6, brushId: makeBrushId(8, 0, 0), stratum: 8,
      from: 0, through: 4, bytes: 2048, epoch: 1, edition: 1, expires: 5000, rgba: null,
    };

    // Predicate 5: ALL
    expect(sink.matchesScrape(recE1, 5, new Uint8Array(0))).toBe(true);

    // Predicate 1: ESTRATO_BAJO (drop if s < stratum)
    expect(sink.matchesScrape(recE1, 1, new Uint8Array([2]))).toBe(true);
    expect(sink.matchesScrape(recE1, 1, new Uint8Array([1]))).toBe(false);

    // Predicate 3: BANDAS (drop if stratum === e && upper > bandasMax)
    expect(sink.matchesScrape(recE1, 3, new Uint8Array([1, 1]))).toBe(true);
    expect(sink.matchesScrape(recE1, 3, new Uint8Array([1, 3]))).toBe(false);
    expect(sink.matchesScrape(recE8, 3, new Uint8Array([1, 1]))).toBe(false);

    // Predicate 4: LISTA
    const listParams = rangesEncode([5, 10]);
    expect(sink.matchesScrape(recE1, 4, listParams)).toBe(true);
    expect(sink.matchesScrape(recE8, 4, listParams)).toBe(false);

    // Predicate 2: FUERA (rect intersection for s < 7)
    // recE1 is at s=1, bx=0, by=0 -> rect is [0, 0, 512, 512]
    const outsideRect = concat(viEncode(1000), viEncode(1000), viEncode(2000), viEncode(2000));
    const insideRect = concat(viEncode(100), viEncode(100), viEncode(400), viEncode(400));
    expect(sink.matchesScrape(recE1, 2, outsideRect)).toBe(true); // outside, so drop
    expect(sink.matchesScrape(recE1, 2, insideRect)).toBe(false); // intersects, so keep
    expect(sink.matchesScrape(recE8, 2, outsideRect)).toBe(false); // s=8 >= 7, never dropped by FUERA

    sink.dispose();
  });

  it('applyRaspar removes matching records and sends exact RASPADO', () => {
    const client = fakeClient();
    const sink = new DeliverySink(1, () => client, () => 36864, () => 768);

    sink.book.byDelivery.set(1, {
      delivery: 1, brushId: makeBrushId(0, 0, 0), stratum: 0,
      from: 0, through: 1, bytes: 1024, epoch: 1, edition: 1, expires: 5000, rgba: null,
    });
    sink.book.byDelivery.set(2, {
      delivery: 2, brushId: makeBrushId(2, 0, 0), stratum: 2,
      from: 0, through: 1, bytes: 2048, epoch: 1, edition: 1, expires: 5000, rgba: null,
    });
    sink.book.byDelivery.set(3, {
      delivery: 3, brushId: makeBrushId(0, 1, 0), stratum: 0,
      from: 0, through: 1, bytes: 1024, epoch: 1, edition: 1, expires: 5000, rgba: null,
    });

    // Scrape stratum < 1 up to delivery 2
    sink.applyRaspar({
      handle: 1, order: 5, epoch: 2, through: 2, predicate: 1, params: new Uint8Array([1]),
    }, () => 1000);

    expect(client.sentRaspado.length).toBe(1);
    const r = client.sentRaspado[0];
    expect(r?.order).toBe(5);
    expect(r?.through).toBe(2);
    expect(r?.raspadas).toBe(1); // delivery 1 was scraped
    expect(r?.conservadas).toEqual([2]); // delivery 2 was kept
    expect(sink.book.byDelivery.has(1)).toBe(false);
    expect(sink.book.byDelivery.has(2)).toBe(true);
    expect(sink.book.byDelivery.has(3)).toBe(true); // delivery 3 > through 2, untouched

    sink.dispose();
  });

  it('applyRenovar extends lease and inventory reports accurately', () => {
    const client = fakeClient();
    const sink = new DeliverySink(1, () => client, () => 36864, () => 768);

    sink.book.byDelivery.set(10, {
      delivery: 10, brushId: makeBrushId(1, 0, 0), stratum: 1,
      from: 0, through: 1, bytes: 1500, epoch: 1, edition: 1, expires: 2000, rgba: null,
    });

    sink.applyRenovar([10], 4, 120, () => 1000);
    expect(sink.book.byDelivery.get(10)?.expires).toBe(1000 + 120000);
    expect(sink.renewThrough).toBe(4);

    const inv = sink.inventory(20);
    expect(inv.brushCount).toBe(1);
    expect(inv.kib).toBe(2);
    expect(inv.ranges).toEqual([10]);

    sink.dispose();
  });

  it('sweepExpiry purges expired records and sends batched SOLTAR reason=3', () => {
    vi.useFakeTimers();
    const client = fakeClient();
    const sink = new DeliverySink(1, () => client, () => 36864, () => 768);

    sink.book.byDelivery.set(1, {
      delivery: 1, brushId: makeBrushId(1, 0, 0), stratum: 1,
      from: 0, through: 1, bytes: 500, epoch: 1, edition: 1, expires: 500, rgba: null,
    });

    sink.sweepExpiry(() => 1000); // 1000 > expires 500
    expect(sink.book.byDelivery.has(1)).toBe(false);

    vi.advanceTimersByTime(100);
    expect(client.sentSoltar).toEqual([{ handle: 1, reason: 3, ranges: [1] }]);

    sink.dispose();
    vi.useRealTimers();
  });
});
