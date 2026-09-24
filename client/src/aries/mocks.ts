import { concat, viEncode } from '@/shared/proto/varint';
import {
  T,
  bienvenidaCore,
  bienvenidaTlvs,
  concesionCore,
  gazeCore,
  planCore,
  scrapedCore,
  receiptCore,
  renewCore,
  saludoCore,
  saludoTlvs,
} from '@/shared/proto/messages';
import { encodeFrame } from '@/shared/proto/frame';

function token32(): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = (0xde + i * 31) & 0xff;
  return out;
}

function ficha32(): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = (0x7a + i * 17) & 0xff;
  return out;
}

function rangeList(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let n = lo; n <= hi; n++) out.push(n);
  return out;
}

const SESION_ID = 0x3a915e0c77d214b8n;

export const VECTORS = {
  saludoFrame(): Uint8Array {
    const core = saludoCore({ verMin: 1, verMax: 1, caps: 3, memMib: 256, token: token32() });
    return encodeFrame(T.SALUDO, core);
  },
  bienvenidaFrame(): Uint8Array {
    const b = {
      version: 1, caps: 3, sessionId: SESION_ID, lado: 256, leaseS: 120,
      latidoS: 15, maxEnVuelo: 12, sesionMaxPinceladas: 1024, ticket: ficha32(), resumed: [] as number[],
    };
    return encodeFrame(T.BIENVENIDA, bienvenidaCore(b), bienvenidaTlvs(b));
  },
  miradaDatagram(): Uint8Array {
    return concat(
      viEncode(T.MIRADA),
      gazeCore({ handle: 1, seq: 8, x0: 65536, y0: 49152, x1: 69376, y1: 51312, vw: 1920, vh: 1080, mflags: 0 }),
    );
  },
  concesionSketch(): Uint8Array {
    return encodeFrame(T.CONCESION, concesionCore({
      handle: 1, epoch: 1, estratoMin: 7, bandasMax: 4, reason: 0,
      maxBrushes: 768, maxKiB: 36864, leaseS: 120,
    }));
  },
  planInicio(): Uint8Array {
    return encodeFrame(T.PLAN, planCore({ handle: 1, gazeSeq: 8, event: 0, first: 45, expectedCount: 212, throttle: 0 }));
  },
  receipt(): Uint8Array {
    return encodeFrame(T.RECIBO, receiptCore({
      handle: 1, completed: [...rangeList(45, 51), ...rangeList(53, 60)],
      queueMs: 40, libre: 708, renewThrough: 0,
    }));
  },
  raspadoFull(): Uint8Array {
    return encodeFrame(T.RASPADO, scrapedCore({
      handle: 1, order: 3, epoch: 3, through: 289, raspadas: 28, liberadasKib: 216, conservadas: rangeList(1, 256),
    }));
  },
  renew(): Uint8Array {
    return encodeFrame(T.RENOVAR, renewCore({
      handle: 1, order: 12, leaseS: 120, ranges: [...rangeList(1, 256), ...rangeList(290, 336)],
    }));
  },
  saludoReanudar(): Uint8Array {
    const s = {
      verMin: 1, verMax: 1, caps: 3, memMib: 256, token: token32(),
      resume: {
        sesionAnterior: SESION_ID, ticket: ficha32(),
        claims: [{ handle: 1, ranges: [...rangeList(1, 256), ...rangeList(290, 336)] }],
      },
    };
    return encodeFrame(T.SALUDO, saludoCore(s), saludoTlvs(s));
  },
};
