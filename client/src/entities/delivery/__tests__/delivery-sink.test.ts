import { describe, expect, it, vi } from 'vitest';
import { DeliverySink } from '@/app/providers/delivery-sink';
import { crc32c } from '@/shared/codec/crc32c';
import { concat, viEncode } from '@/shared/proto/varint';
import { rangesEncode } from '@/shared/proto/ranges';
import { pinceladaIdMake } from '@/shared/proto/pincelada';
import type { SessionClient } from '@/app/providers/session-client';

function fakeClient() {
  const sentSoltar: Array<{ handle: number; motivo: number; rangos: number[] }> = [];
  const sentRaspado: Array<{ handle: number; orden: number; epoca: number; hasta: number; raspadas: number; liberadasKib: number; conservadas: number[] }> = [];
  const sentRecibo: Array<{ handle: number; completadas: number[]; colaMs: number; libre: number; renovHasta: number }> = [];
  const sentInventario: Array<{ handle: number; orden: number; hasta: number; pinceladas: number; kib: number; rangos: number[] }> = [];

  const c = {
    sentSoltar,
    sentRaspado,
    sentRecibo,
    sentInventario,
    sendSoltar(handle: number, motivo: number, rangos: number[]) {
      sentSoltar.push({ handle, motivo, rangos });
    },
    sendRaspado(handle: number, orden: number, epoca: number, hasta: number, raspadas: number, liberadasKib: number, conservadas: number[]) {
      sentRaspado.push({ handle, orden, epoca, hasta, raspadas, liberadasKib, conservadas });
    },
    sendRecibo(handle: number, completadas: number[], colaMs: number, libre: number, renovHasta: number) {
      sentRecibo.push({ handle, completadas, colaMs, libre, renovHasta });
    },
    sendInventario(handle: number, orden: number, hasta: number, pinceladas: number, kib: number, rangos: number[]) {
      sentInventario.push({ handle, orden, hasta, pinceladas, kib, rangos });
    },
  };
  return c as unknown as SessionClient & typeof c;
}

function makeDeliveryBytes(opts: {
  handle: number;
  entrega: number;
  pinceladaId: bigint;
  desde: number;
  hasta: number;
  epoca: number;
  qY?: number;
  qC?: number;
  corruptCrc?: boolean;
}): Uint8Array {
  const band = new Uint8Array([10, 20, 30, 40, 50]);
  const bandCrc = crc32c(band);
  const crcVal = opts.corruptCrc ? bandCrc ^ 0xff : bandCrc;

  const bIdBuf = new Uint8Array(8);
  new DataView(bIdBuf.buffer).setBigUint64(0, opts.pinceladaId);

  const crcBuf = new Uint8Array(4);
  new DataView(crcBuf.buffer).setUint32(0, crcVal);

  const head = concat(
    viEncode(0x01),
    viEncode(opts.handle),
    viEncode(opts.entrega),
    bIdBuf,
    new Uint8Array([((opts.desde & 0xf) << 4) | (opts.hasta & 0xf)]),
    viEncode(opts.epoca),
    new Uint8Array([opts.qY ?? 4, opts.qC ?? 6]),
    viEncode(1), // edicion
    crcBuf,
    viEncode(band.length),
  );
  return concat(head, band);
}

describe('DeliverySink', () => {
  it('rejects delivery with mismatched CRC and sends SOLTAR motivo=6', () => {
    const client = fakeClient();
    const sink = new DeliverySink(1, () => client, () => 36864, () => 768);
    const bytes = makeDeliveryBytes({
      handle: 1,
      entrega: 10,
      pinceladaId: pinceladaIdMake(1, 0, 0),
      desde: 0,
      hasta: 1,
      epoca: 1,
      corruptCrc: true,
    });
    sink.ingest(bytes, () => 1000, () => {}, 120);
    expect(sink.book.byEntrega.size).toBe(0);
    expect(client.sentSoltar).toEqual([{ handle: 1, motivo: 6, rangos: [10] }]);
    sink.dispose();
  });

  it('matchesRaspar evaluates all 5 protocol predicates', () => {
    const client = fakeClient();
    const sink = new DeliverySink(1, () => client, () => 36864, () => 768);

    const recE1 = {
      entrega: 5, pinceladaId: pinceladaIdMake(1, 0, 0), estrato: 1,
      desde: 0, hasta: 2, bytes: 1024, epoca: 1, edicion: 1, vence: 5000, rgba: null,
    };
    const recE8 = {
      entrega: 6, pinceladaId: pinceladaIdMake(8, 0, 0), estrato: 8,
      desde: 0, hasta: 4, bytes: 2048, epoca: 1, edicion: 1, vence: 5000, rgba: null,
    };

    // Predicate 5: ALL
    expect(sink.matchesRaspar(recE1, 5, new Uint8Array(0))).toBe(true);

    // Predicate 1: ESTRATO_BAJO (drop if s < stratum)
    expect(sink.matchesRaspar(recE1, 1, new Uint8Array([2]))).toBe(true);
    expect(sink.matchesRaspar(recE1, 1, new Uint8Array([1]))).toBe(false);

    // Predicate 3: BANDAS (drop if stratum === e && upper > bandasMax)
    expect(sink.matchesRaspar(recE1, 3, new Uint8Array([1, 1]))).toBe(true);
    expect(sink.matchesRaspar(recE1, 3, new Uint8Array([1, 3]))).toBe(false);
    expect(sink.matchesRaspar(recE8, 3, new Uint8Array([1, 1]))).toBe(false);

    // Predicate 4: LISTA
    const listParams = rangesEncode([5, 10]);
    expect(sink.matchesRaspar(recE1, 4, listParams)).toBe(true);
    expect(sink.matchesRaspar(recE8, 4, listParams)).toBe(false);

    // Predicate 2: FUERA (rect intersection for s < 7)
    // recE1 is at s=1, bx=0, by=0 -> rect is [0, 0, 512, 512]
    const outsideRect = concat(viEncode(1000), viEncode(1000), viEncode(2000), viEncode(2000));
    const insideRect = concat(viEncode(100), viEncode(100), viEncode(400), viEncode(400));
    expect(sink.matchesRaspar(recE1, 2, outsideRect)).toBe(true); // outside, so drop
    expect(sink.matchesRaspar(recE1, 2, insideRect)).toBe(false); // intersects, so keep
    expect(sink.matchesRaspar(recE8, 2, outsideRect)).toBe(false); // s=8 >= 7, never dropped by FUERA

    sink.dispose();
  });

  it('applyRaspar removes matching records and sends exact RASPADO', () => {
    const client = fakeClient();
    const sink = new DeliverySink(1, () => client, () => 36864, () => 768);

    sink.book.byEntrega.set(1, {
      entrega: 1, pinceladaId: pinceladaIdMake(0, 0, 0), estrato: 0,
      desde: 0, hasta: 1, bytes: 1024, epoca: 1, edicion: 1, vence: 5000, rgba: null,
    });
    sink.book.byEntrega.set(2, {
      entrega: 2, pinceladaId: pinceladaIdMake(2, 0, 0), estrato: 2,
      desde: 0, hasta: 1, bytes: 2048, epoca: 1, edicion: 1, vence: 5000, rgba: null,
    });
    sink.book.byEntrega.set(3, {
      entrega: 3, pinceladaId: pinceladaIdMake(0, 1, 0), estrato: 0,
      desde: 0, hasta: 1, bytes: 1024, epoca: 1, edicion: 1, vence: 5000, rgba: null,
    });

    // Scrape stratum < 1 up to delivery 2
    sink.applyRaspar({
      handle: 1, orden: 5, epoca: 2, hasta: 2, predicado: 1, params: new Uint8Array([1]),
    }, () => 1000);

    expect(client.sentRaspado.length).toBe(1);
    const r = client.sentRaspado[0];
    expect(r?.orden).toBe(5);
    expect(r?.hasta).toBe(2);
    expect(r?.raspadas).toBe(1); // delivery 1 was scraped
    expect(r?.conservadas).toEqual([2]); // delivery 2 was kept
    expect(sink.book.byEntrega.has(1)).toBe(false);
    expect(sink.book.byEntrega.has(2)).toBe(true);
    expect(sink.book.byEntrega.has(3)).toBe(true); // delivery 3 > hasta 2, untouched

    sink.dispose();
  });

  it('applyRenovar extends lease and inventory reports accurately', () => {
    const client = fakeClient();
    const sink = new DeliverySink(1, () => client, () => 36864, () => 768);

    sink.book.byEntrega.set(10, {
      entrega: 10, pinceladaId: pinceladaIdMake(1, 0, 0), estrato: 1,
      desde: 0, hasta: 1, bytes: 1500, epoca: 1, edicion: 1, vence: 2000, rgba: null,
    });

    sink.applyRenovar([10], 4, 120, () => 1000);
    expect(sink.book.byEntrega.get(10)?.vence).toBe(1000 + 120000);
    expect(sink.renovHasta).toBe(4);

    const inv = sink.inventory(20);
    expect(inv.pinceladas).toBe(1);
    expect(inv.kib).toBe(2);
    expect(inv.rangos).toEqual([10]);

    sink.dispose();
  });

  it('sweepExpiry purges expired records and sends batched SOLTAR motivo=3', () => {
    vi.useFakeTimers();
    const client = fakeClient();
    const sink = new DeliverySink(1, () => client, () => 36864, () => 768);

    sink.book.byEntrega.set(1, {
      entrega: 1, pinceladaId: pinceladaIdMake(1, 0, 0), estrato: 1,
      desde: 0, hasta: 1, bytes: 500, epoca: 1, edicion: 1, vence: 500, rgba: null,
    });

    sink.sweepExpiry(() => 1000); // 1000 > vence 500
    expect(sink.book.byEntrega.has(1)).toBe(false);

    vi.advanceTimersByTime(100);
    expect(client.sentSoltar).toEqual([{ handle: 1, motivo: 3, rangos: [1] }]);

    sink.dispose();
    vi.useRealTimers();
  });
});
