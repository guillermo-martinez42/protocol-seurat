import { describe, expect, it } from 'vitest';
import { SessionClient } from '@/app/providers/session-client';
import { DeliverySink } from '@/app/providers/delivery-sink';
import { encodeFrame } from '@/shared/proto/frame';
import {
  T,
  bienvenidaCore,
  bienvenidaTlvs,
  obraCore,
  abiertaCore,
  concesionCore,
  planCore,
  scrapeCore,
  auditCore,
  abrirDecode,
  scrapedDecode,
  inventoryDecode,
  releaseDecode,
  type WorkMsg,
} from '@/shared/proto/messages';
import { makeBrushId } from '@/shared/proto/brush';
import { crc32c } from '@/shared/codec/crc32c';
import { concat, viDecode, viEncode } from '@/shared/proto/varint';
import type { SeuratTransport } from '@/shared/api/transport';

function makePinceladaBytes(handle: number, delivery: number, brushId: bigint): Uint8Array {
  const band = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const c = crc32c(band);
  const bIdBuf = new Uint8Array(8);
  new DataView(bIdBuf.buffer).setBigUint64(0, brushId);
  const crcBuf = new Uint8Array(4);
  new DataView(crcBuf.buffer).setUint32(0, c);

  return concat(
    viEncode(0x01), // PINCELADA
    viEncode(handle),
    viEncode(delivery),
    bIdBuf,
    [0x01], // from=0, through=1
    viEncode(1), // epoch
    [10, 10], // qY, qC
    viEncode(1), // edition
    crcBuf,
    viEncode(band.length),
    band,
  );
}

describe('End-to-End Protocol Flow Integration', () => {
  it('executes full session, catalog, open, delivery, audit, and eviction cycle', async () => {
    const sentControl: Uint8Array[] = [];
    const sentMiradas: Uint8Array[] = [];

    const transport: SeuratTransport = {
      name: 'websocket',
      datagramas: false,
      onControl: null,
      onDelivery: null,
      onClose: null,
      sendControl(f: Uint8Array) {
        sentControl.push(f);
      },
      sendMiradaDatagram(d: Uint8Array) {
        sentMiradas.push(d);
      },
      close() {},
    };

    const works: WorkMsg[] = [];
    let activeHandle: number | null = null;
    let activeEpoch: number | null = null;

    let sink!: DeliverySink;
    const client = new SessionClient({
      onBienvenida: () => {},
      onObra: (o) => works.push(o),
      onAbierta: (a) => {
        activeHandle = a.handle;
      },
      onConcesion: (c) => {
        activeEpoch = c.epoch;
      },
      onPlan: () => {},
      onRaspar: (r) => sink.applyRaspar(r, () => performance.now()),
      onRenovar: (r) => sink.applyRenovar(r.ranges, r.order, r.leaseS, () => performance.now()),
      onAuditar: (a) => {
        const inv = sink.inventory(a.through);
        client.sendInventory(a.handle, a.order, a.through, inv.brushCount, inv.kib, inv.ranges);
      },
      onProtoError: () => {},
      onDelivery: (d) => sink.ingest(d, () => performance.now(), () => {}, 30),
      onStatus: () => {},
    });

    client.wire(transport);

    sink = new DeliverySink(
      1,
      () => client,
      () => 512,
      () => 128,
      192,
      160,
    );

    // 1. Handshake: BIENVENIDA from server
    const b = {
      version: 1,
      caps: 0x01,
      sessionId: 0xfeedfacecafe0001n,
      lado: 256,
      leaseS: 60,
      latidoS: 10,
      maxEnVuelo: 16,
      sesionMaxPinceladas: 1000,
      ticket: new TextEncoder().encode('test-fiche'),
      resumed: [],
    };
    const bienvenida = encodeFrame(
      T.BIENVENIDA,
      concat(bienvenidaCore(b), ...bienvenidaTlvs(b)),
    );
    transport.onControl?.(bienvenida);

    // 2. Catalog: Server delivers OBRA metadata
    const obra1 = encodeFrame(
      T.OBRA,
      obraCore({
        event: 1, // ALTA
        estado: 3, // DISPONIBLE
        progreso: 100,
        edition: 1,
        width: 8000,
        height: 6000,
        estratos: 8,
        id: 'work-01',
        name: 'Sunday Afternoon',
      }),
    );
    transport.onControl?.(obra1);
    expect(works.length).toBe(1);
    expect(works[0]?.id).toBe('work-01');
    expect(works[0]?.name).toBe('Sunday Afternoon');

    // 3. Open work: Client sends ABRIR
    client.openObra('work-01');
    expect(sentControl.length).toBe(1);
    const abrirFrame = sentControl[0]!;
    const hType = viDecode(abrirFrame, 0);
    expect(hType.value).toBe(T.ABRIR);
    expect(abrirDecode(abrirFrame.slice(hType.next + 1))).toBe('work-01');

    // Server responds with ABIERTA + initial CONCESION
    transport.onControl?.(
      encodeFrame(
        T.ABIERTA,
        abiertaCore({
          handle: 1,
          width: 8000,
          height: 6000,
          estratos: 8,
          edition: 1,
          techoEstrato: 8,
          techoBandas: 4,
          semillaAncho: 192,
          semillaAlto: 160,
        }),
      ),
    );
    expect(activeHandle).toBe(1);

    transport.onControl?.(
      encodeFrame(
        T.CONCESION,
        concesionCore({
          handle: 1,
          epoch: 1,
          estratoMin: 0,
          bandasMax: 4,
          reason: 0,
          maxBrushes: 64,
          maxKiB: 4096,
          leaseS: 30,
        }),
      ),
    );
    expect(activeEpoch).toBe(1);

    // 4. Client reports MIRADA; Server sends PLAN
    transport.sendMiradaDatagram(new Uint8Array([1, 2, 3]));
    expect(sentMiradas.length).toBe(1);

    transport.onControl?.(
      encodeFrame(
        T.PLAN,
        planCore({
          handle: 1,
          gazeSeq: 1,
          event: 0,
          first: 1,
          expectedCount: 2,
          throttle: 0,
        }),
      ),
    );

    // 5. Stream deliveries into sink
    const pId1 = makeBrushId(7, 0, 0);
    const pId2 = makeBrushId(7, 1, 0);
    sink.ingest(makePinceladaBytes(1, 1, pId1), () => performance.now(), () => {}, 30);
    sink.ingest(makePinceladaBytes(1, 2, pId2), () => performance.now(), () => {}, 30);

    expect(sink.book.byDelivery.has(1)).toBe(true);
    expect(sink.book.byDelivery.has(2)).toBe(true);

    // 6. Server issues AUDITAR: Client answers with INVENTARIO
    sentControl.length = 0;
    transport.onControl?.(
      encodeFrame(
        T.AUDITAR,
        auditCore({ handle: 1, order: 42, through: 2 }),
      ),
    );

    expect(sentControl.length).toBe(1);
    const invFrame = sentControl[0]!;
    const invType = viDecode(invFrame, 0);
    expect(invType.value).toBe(T.INVENTARIO);
    const inv = inventoryDecode(invFrame.slice(invType.next + 1));
    expect(inv.handle).toBe(1);
    expect(inv.order).toBe(42);
    expect(inv.brushCount).toBe(2);
    expect(inv.ranges).toEqual([1, 2]);

    // 7. Server issues RASPAR with predicate 1 (ESTRATO_MENOR):
    // drop deliveries with stratum < 8 (our deliveries have stratum 7)
    sentControl.length = 0;
    transport.onControl?.(
      encodeFrame(
        T.RASPAR,
        scrapeCore({
          handle: 1,
          order: 99,
          epoch: 1,
          through: 2,
          predicate: 1,
          params: new Uint8Array([8]),
        }),
      ),
    );

    expect(sentControl.length).toBe(1);
    const raspFrame = sentControl[0]!;
    const raspType = viDecode(raspFrame, 0);
    expect(raspType.value).toBe(T.RASPADO);
    const rasp = scrapedDecode(raspFrame.slice(raspType.next + 1));
    expect(rasp.handle).toBe(1);
    expect(rasp.order).toBe(99);
    expect(rasp.raspadas).toBe(2);
    expect(rasp.conservadas).toEqual([]);
    expect(sink.book.byDelivery.size).toBe(0);

    // 8. Lease expiry: add a delivery with past expires timestamp
    sink.ingest(makePinceladaBytes(1, 10, pId1), () => performance.now(), () => {}, 30);
    const rec = sink.book.byDelivery.get(10)!;
    rec.expires = performance.now() - 500; // already expired
    sentControl.length = 0;

    // Sweep expiry triggers SOLTAR reason=3
    sink.sweepExpiry(() => performance.now());
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(sentControl.length).toBe(1);
    const soltFrame = sentControl[0]!;
    const soltType = viDecode(soltFrame, 0);
    expect(soltType.value).toBe(T.SOLTAR);
    const solt = releaseDecode(soltFrame.slice(soltType.next + 1));
    expect(solt.handle).toBe(1);
    expect(solt.reason).toBe(3); // CADUCADA
    expect(solt.ranges).toEqual([10]);

    sink.dispose();
  });
});
