import { concat, viEncode } from '@/shared/proto/varint';
import {
  T,
  bienvenidaCore,
  bienvenidaTlvs,
  concesionCore,
  miradaCore,
  planCore,
  raspadoCore,
  reciboCore,
  renovarCore,
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
      version: 1, caps: 3, sesionId: SESION_ID, lado: 256, arriendoS: 120,
      latidoS: 15, maxEnVuelo: 12, sesionMaxPinceladas: 1024, ficha: ficha32(), reanudada: [] as number[],
    };
    return encodeFrame(T.BIENVENIDA, bienvenidaCore(b), bienvenidaTlvs(b));
  },
  miradaDatagram(): Uint8Array {
    return concat(
      viEncode(T.MIRADA),
      miradaCore({ handle: 1, seq: 8, x0: 65536, y0: 49152, x1: 69376, y1: 51312, vw: 1920, vh: 1080, mflags: 0 }),
    );
  },
  concesionSketch(): Uint8Array {
    return encodeFrame(T.CONCESION, concesionCore({
      handle: 1, epoca: 1, estratoMin: 7, bandasMax: 4, motivo: 0,
      maxPinceladas: 768, maxKib: 36864, arriendoS: 120,
    }));
  },
  planInicio(): Uint8Array {
    return encodeFrame(T.PLAN, planCore({ handle: 1, seqMirada: 8, evento: 0, primera: 45, previstas: 212, regulacion: 0 }));
  },
  recibo(): Uint8Array {
    return encodeFrame(T.RECIBO, reciboCore({
      handle: 1, completadas: [...rangeList(45, 51), ...rangeList(53, 60)],
      colaMs: 40, libre: 708, renovHasta: 0,
    }));
  },
  raspadoFull(): Uint8Array {
    return encodeFrame(T.RASPADO, raspadoCore({
      handle: 1, orden: 3, epoca: 3, hasta: 289, raspadas: 28, liberadasKib: 216, conservadas: rangeList(1, 256),
    }));
  },
  renovar(): Uint8Array {
    return encodeFrame(T.RENOVAR, renovarCore({
      handle: 1, orden: 12, arriendoS: 120, rangos: [...rangeList(1, 256), ...rangeList(290, 336)],
    }));
  },
  saludoReanudar(): Uint8Array {
    const s = {
      verMin: 1, verMax: 1, caps: 3, memMib: 256, token: token32(),
      reanudar: {
        sesionAnterior: SESION_ID, ficha: ficha32(),
        claims: [{ handle: 1, rangos: [...rangeList(1, 256), ...rangeList(290, 336)] }],
      },
    };
    return encodeFrame(T.SALUDO, saludoCore(s), saludoTlvs(s));
  },
};
