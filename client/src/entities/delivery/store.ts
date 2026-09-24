import { rangesEqual } from '@/shared/proto/ranges';

export interface DeliveryRecord {
  delivery: number;
  brushId: bigint;
  stratum: number;
  from: number;
  through: number;
  bytes: number;
  epoch: number;
  edition: number;
  expires: number;
  rgba: ImageBitmap | null;
}

export interface DeliveryLedger {
  byDelivery: Map<number, DeliveryRecord>;
  inFlight: Set<number>;
  pendingReceipt: number[];
  pendingRaspados: Array<{ order: number; through: number }>;
}

export function emptyLedger(): DeliveryLedger {
  return { byDelivery: new Map(), inFlight: new Set(), pendingReceipt: [], pendingRaspados: [] };
}

export function ownedDeliveries(b: DeliveryLedger): number[] {
  return [...b.byDelivery.keys()].sort((a, b2) => a - b2);
}

export function ownedBytes(b: DeliveryLedger): number {
  let n = 0;
  for (const r of b.byDelivery.values()) n += r.bytes;
  return n;
}

export function confirmScraped(keep: number[], through: number, expected: number[]): boolean {
  const got = keep.filter((n) => n <= through);
  return rangesEqual(got, expected);
}

export function effectiveExpiry(rec: DeliveryRecord, parentVence: number | null): number {
  return parentVence === null ? rec.expires : Math.min(rec.expires, parentVence);
}
