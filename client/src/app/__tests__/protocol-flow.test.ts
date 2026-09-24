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
  rasparCore,
  auditarCore,
  abrirDecode,
  raspadoDecode,
  inventarioDecode,
  soltarDecode,
  type ObraMsg,
} from '@/shared/proto/messages';
import { pinceladaIdMake } from '@/shared/proto/pincelada';
import { crc32c } from '@/shared/codec/crc32c';
import { concat, viDecode, viEncode } from '@/shared/proto/varint';
import type { SeuratTransport } from '@/shared/api/transport';

function makePinceladaBytes(handle: number, entrega: number, pinceladaId: bigint): Uint8Array {
  const band = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const c = crc32c(band);
  const bIdBuf = new Uint8Array(8);
  new DataView(bIdBuf.buffer).setBigUint64(0, pinceladaId);
  const crcBuf = new Uint8Array(4);
  new DataView(crcBuf.buffer).setUint32(0, c);

  return concat(
    viEncode(0x01), // PINCELADA
    viEncode(handle),
    viEncode(entrega),
    bIdBuf,
    [0x01], // desde=0, hasta=1
    viEncode(1), // epoca
    [10, 10], // qY, qC
    viEncode(1), // edicion
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

    const obras: ObraMsg[] = [];
    let activeHandle: number | null = null;
    let activeEpoch: number | null = null;

    let sink!: DeliverySink;
    const client = new SessionClient({
      onBienvenida: () => {},
      onObra: (o) => obras.push(o),
      onAbierta: (a) => {
        activeHandle = a.handle;
      },
      onConcesion: (c) => {
        activeEpoch = c.epoca;
      },
      onPlan: () => {},
      onRaspar: (r) => sink.applyRaspar(r, () => performance.now()),
      onRenovar: (r) => sink.applyRenovar(r.rangos, r.orden, r.arriendoS, () => performance.now()),
      onAuditar: (a) => {
        const inv = sink.inventory(a.hasta);
        client.sendInventario(a.handle, a.orden, a.hasta, inv.pinceladas, inv.kib, inv.rangos);
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
      sesionId: 0xfeedfacecafe0001n,
      lado: 256,
      arriendoS: 60,
      latidoS: 10,
      maxEnVuelo: 16,
      sesionMaxPinceladas: 1000,
      ficha: new TextEncoder().encode('test-fiche'),
      reanudada: [],
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
        evento: 1, // ALTA
        estado: 3, // DISPONIBLE
        progreso: 100,
        edicion: 1,
        ancho: 8000,
        alto: 6000,
        estratos: 8,
        id: 'obra-01',
        nombre: 'Sunday Afternoon',
      }),
    );
    transport.onControl?.(obra1);
    expect(obras.length).toBe(1);
    expect(obras[0]?.id).toBe('obra-01');
    expect(obras[0]?.nombre).toBe('Sunday Afternoon');

    // 3. Open work: Client sends ABRIR
    client.openObra('obra-01');
    expect(sentControl.length).toBe(1);
    const abrirFrame = sentControl[0]!;
    const hType = viDecode(abrirFrame, 0);
    expect(hType.value).toBe(T.ABRIR);
    expect(abrirDecode(abrirFrame.slice(hType.next + 1))).toBe('obra-01');

    // Server responds with ABIERTA + initial CONCESION
    transport.onControl?.(
      encodeFrame(
        T.ABIERTA,
        abiertaCore({
          handle: 1,
          ancho: 8000,
          alto: 6000,
          estratos: 8,
          edicion: 1,
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
          epoca: 1,
          estratoMin: 0,
          bandasMax: 4,
          motivo: 0,
          maxPinceladas: 64,
          maxKib: 4096,
          arriendoS: 30,
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
          seqMirada: 1,
          evento: 0,
          primera: 1,
          previstas: 2,
          regulacion: 0,
        }),
      ),
    );

    // 5. Stream deliveries into sink
    const pId1 = pinceladaIdMake(7, 0, 0);
    const pId2 = pinceladaIdMake(7, 1, 0);
    sink.ingest(makePinceladaBytes(1, 1, pId1), () => performance.now(), () => {}, 30);
    sink.ingest(makePinceladaBytes(1, 2, pId2), () => performance.now(), () => {}, 30);

    expect(sink.book.byEntrega.has(1)).toBe(true);
    expect(sink.book.byEntrega.has(2)).toBe(true);

    // 6. Server issues AUDITAR: Client answers with INVENTARIO
    sentControl.length = 0;
    transport.onControl?.(
      encodeFrame(
        T.AUDITAR,
        auditarCore({ handle: 1, orden: 42, hasta: 2 }),
      ),
    );

    expect(sentControl.length).toBe(1);
    const invFrame = sentControl[0]!;
    const invType = viDecode(invFrame, 0);
    expect(invType.value).toBe(T.INVENTARIO);
    const inv = inventarioDecode(invFrame.slice(invType.next + 1));
    expect(inv.handle).toBe(1);
    expect(inv.orden).toBe(42);
    expect(inv.pinceladas).toBe(2);
    expect(inv.rangos).toEqual([1, 2]);

    // 7. Server issues RASPAR with predicate 1 (ESTRATO_MENOR):
    // drop deliveries with stratum < 8 (our deliveries have stratum 7)
    sentControl.length = 0;
    transport.onControl?.(
      encodeFrame(
        T.RASPAR,
        rasparCore({
          handle: 1,
          orden: 99,
          epoca: 1,
          hasta: 2,
          predicado: 1,
          params: new Uint8Array([8]),
        }),
      ),
    );

    expect(sentControl.length).toBe(1);
    const raspFrame = sentControl[0]!;
    const raspType = viDecode(raspFrame, 0);
    expect(raspType.value).toBe(T.RASPADO);
    const rasp = raspadoDecode(raspFrame.slice(raspType.next + 1));
    expect(rasp.handle).toBe(1);
    expect(rasp.orden).toBe(99);
    expect(rasp.raspadas).toBe(2);
    expect(rasp.conservadas).toEqual([]);
    expect(sink.book.byEntrega.size).toBe(0);

    // 8. Lease expiry: add a delivery with past vence timestamp
    sink.ingest(makePinceladaBytes(1, 10, pId1), () => performance.now(), () => {}, 30);
    const rec = sink.book.byEntrega.get(10)!;
    rec.vence = performance.now() - 500; // already expired
    sentControl.length = 0;

    // Sweep expiry triggers SOLTAR motivo=3
    sink.sweepExpiry(() => performance.now());
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(sentControl.length).toBe(1);
    const soltFrame = sentControl[0]!;
    const soltType = viDecode(soltFrame, 0);
    expect(soltType.value).toBe(T.SOLTAR);
    const solt = soltarDecode(soltFrame.slice(soltType.next + 1));
    expect(solt.handle).toBe(1);
    expect(solt.motivo).toBe(3); // CADUCADA
    expect(solt.rangos).toEqual([10]);

    sink.dispose();
  });
});
