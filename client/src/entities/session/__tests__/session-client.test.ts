import { describe, expect, it } from 'vitest';
import { SessionClient } from '@/app/providers/session-client';
import { encodeFrame } from '@/shared/proto/frame';
import {
  T,
  bienvenidaCore,
  bienvenidaTlvs,
  latidoCore,
  obraCore,
  abiertaCore,
  concesionCore,
  planCore,
  ecoDecode,
  abrirDecode,
  receiptDecode,
  releaseDecode,
  inventoryDecode,
} from '@/shared/proto/messages';
import { concat, viDecode } from '@/shared/proto/varint';
import type { SeuratTransport } from '@/shared/api/transport';

function mockTransport() {
  const sentControl: Uint8Array[] = [];
  const t: SeuratTransport = {
    name: 'websocket',
    datagramas: false,
    onControl: null,
    onDelivery: null,
    onClose: null,
    sendControl(f: Uint8Array) {
      sentControl.push(f);
    },
    sendMiradaDatagram() {},
    close() {},
  };
  return { t, sentControl };
}

describe('SessionClient', () => {
  it('replies to LATIDO with ECO nonce', () => {
    const { t, sentControl } = mockTransport();
    const events = {
      onBienvenida: () => {},
      onObra: () => {},
      onAbierta: () => {},
      onConcesion: () => {},
      onPlan: () => {},
      onRaspar: () => {},
      onRenovar: () => {},
      onAuditar: () => {},
      onProtoError: () => {},
      onDelivery: () => {},
      onStatus: () => {},
    };
    const client = new SessionClient(events);
    // wire transport
    (client as unknown as { transport: SeuratTransport }).transport = t;
    (client as unknown as { wire(t: SeuratTransport): void }).wire(t);

    const nonce = 0x123456789abcdef0n;
    const latidoFrame = encodeFrame(T.LATIDO, latidoCore(nonce));
    t.onControl?.(latidoFrame);

    expect(sentControl.length).toBe(1);
    const reply = sentControl[0];
    expect(reply).toBeDefined();
    // reply is ECO
    const s = viDecode(reply!, 0);
    expect(s.value).toBe(T.ECO);
    const payload = reply!.slice(s.next + 1); // skip length varint
    expect(ecoDecode(payload)).toBe(nonce);
  });

  it('dispatches BIENVENIDA, OBRA, ABIERTA, CONCESION, PLAN', () => {
    const { t } = mockTransport();
    let bienvenidaOk = false;
    let obraOk = false;
    let abiertaOk = false;
    let concesionOk = false;
    let planOk = false;

    const events = {
      onBienvenida: () => { bienvenidaOk = true; },
      onObra: () => { obraOk = true; },
      onAbierta: () => { abiertaOk = true; },
      onConcesion: () => { concesionOk = true; },
      onPlan: () => { planOk = true; },
      onRaspar: () => {},
      onRenovar: () => {},
      onAuditar: () => {},
      onProtoError: () => {},
      onDelivery: () => {},
      onStatus: () => {},
    };
    const client = new SessionClient(events);
    (client as unknown as { transport: SeuratTransport }).transport = t;
    (client as unknown as { wire(t: SeuratTransport): void }).wire(t);

    const b = {
      version: 1, caps: 3, sessionId: 100n, lado: 256, leaseS: 120,
      latidoS: 15, maxEnVuelo: 12, sesionMaxPinceladas: 1024, ticket: new Uint8Array(32), resumed: [],
    };
    t.onControl?.(encodeFrame(T.BIENVENIDA, concat(bienvenidaCore(b), ...bienvenidaTlvs(b))));
    expect(bienvenidaOk).toBe(true);

    t.onControl?.(encodeFrame(T.OBRA, obraCore({
      event: 1, estado: 3, progreso: 100, edition: 1, width: 1000, height: 1000, estratos: 10, id: 'test', name: 'Test',
    })));
    expect(obraOk).toBe(true);

    t.onControl?.(encodeFrame(T.ABIERTA, abiertaCore({
      handle: 1, width: 1000, height: 1000, estratos: 10, edition: 1, techoEstrato: 0, techoBandas: 4, semillaAncho: 192, semillaAlto: 160,
    })));
    expect(abiertaOk).toBe(true);

    t.onControl?.(encodeFrame(T.CONCESION, concesionCore({
      handle: 1, epoch: 1, estratoMin: 7, bandasMax: 4, reason: 0, maxBrushes: 768, maxKiB: 36864, leaseS: 120,
    })));
    expect(concesionOk).toBe(true);

    t.onControl?.(encodeFrame(T.PLAN, planCore({
      handle: 1, gazeSeq: 1, event: 0, first: 1, expectedCount: 10, throttle: 0,
    })));
    expect(planOk).toBe(true);
  });

  it('sends outgoing control messages properly', () => {
    const { t, sentControl } = mockTransport();
    const client = new SessionClient({
      onBienvenida: () => {}, onObra: () => {}, onAbierta: () => {}, onConcesion: () => {},
      onPlan: () => {}, onRaspar: () => {}, onRenovar: () => {}, onAuditar: () => {},
      onProtoError: () => {}, onDelivery: () => {}, onStatus: () => {},
    });
    (client as unknown as { transport: SeuratTransport }).transport = t;

    client.openObra('work-42');
    expect(sentControl.length).toBe(1);
    expect(abrirDecode(sentControl[0]!.slice(2))).toBe('work-42');

    client.sendRecibo(1, [1, 2, 3], 20, 700, 5);
    expect(sentControl.length).toBe(2);
    const rec = receiptDecode(sentControl[1]!.slice(2));
    expect(rec.handle).toBe(1);
    expect(rec.queueMs).toBe(20);
    expect(rec.libre).toBe(700);

    client.sendSoltar(1, 1, [4, 5]);
    expect(sentControl.length).toBe(3);
    const sol = releaseDecode(sentControl[2]!.slice(2));
    expect(sol.reason).toBe(1);
    expect(sol.ranges).toEqual([4, 5]);

    client.sendInventory(1, 2, 10, 5, 200, [1, 2, 3]);
    expect(sentControl.length).toBe(4);
    const inv = inventoryDecode(sentControl[3]!.slice(2));
    expect(inv.brushCount).toBe(5);
    expect(inv.kib).toBe(200);
  });
});
