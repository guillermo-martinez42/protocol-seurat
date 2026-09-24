import { rangesEqual } from '@/shared/proto/ranges';

export interface DeliveryRec {
  entrega: number;
  pinceladaId: bigint;
  estrato: number;
  desde: number;
  hasta: number;
  bytes: number;
  epoca: number;
  edicion: number;
  vence: number;
  rgba: ImageBitmap | null;
}

export interface DeliveryBook {
  byEntrega: Map<number, DeliveryRec>;
  inFlight: Set<number>;
  pendingRecibo: number[];
  pendingRaspados: Array<{ orden: number; hasta: number }>;
}

export function emptyBook(): DeliveryBook {
  return { byEntrega: new Map(), inFlight: new Set(), pendingRecibo: [], pendingRaspados: [] };
}

export function ownedEntregas(b: DeliveryBook): number[] {
  return [...b.byEntrega.keys()].sort((a, b2) => a - b2);
}

export function ownedBytes(b: DeliveryBook): number {
  let n = 0;
  for (const r of b.byEntrega.values()) n += r.bytes;
  return n;
}

export function confirmRaspado(keep: number[], hasta: number, expected: number[]): boolean {
  const got = keep.filter((n) => n <= hasta);
  return rangesEqual(got, expected);
}

export function effectiveVence(rec: DeliveryRec, parentVence: number | null): number {
  return parentVence === null ? rec.vence : Math.min(rec.vence, parentVence);
}
