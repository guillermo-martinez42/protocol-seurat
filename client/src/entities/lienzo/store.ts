import type { Concession } from '@/shared/proto/messages';

export interface CanvasInfo {
  handle: number;
  workId: string;
  width: number;
  height: number;
  estratos: number;
  edition: number;
  techoEstrato: number;
  techoBandas: number;
  semillaAncho: number;
  semillaAlto: number;
  concession: Concession | null;
}

export function permite(c: Concession, s: number, b1: number): boolean {
  if (s > c.estratoMin) return true;
  if (s === c.estratoMin) return b1 <= c.bandasMax;
  return false;
}

export function makeLienzo(
  handle: number,
  workId: string,
  dims: Omit<CanvasInfo, 'handle' | 'workId' | 'concession'>,
): CanvasInfo {
  return { handle, workId, ...dims, concession: null };
}
