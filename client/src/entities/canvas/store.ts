import type { Concession } from '@/shared/proto/messages';

export interface CanvasInfo {
  handle: number;
  workId: string;
  width: number;
  height: number;
  strata: number;
  edition: number;
  ceilingStratum: number;
  ceilingBands: number;
  seedWidth: number;
  seedHeight: number;
  concession: Concession | null;
}

export function allowsAt(c: Concession, s: number, b1: number): boolean {
  if (s > c.minStratum) return true;
  if (s === c.minStratum) return b1 <= c.maxBands;
  return false;
}

export function makeCanvas(
  handle: number,
  workId: string,
  dims: Omit<CanvasInfo, 'handle' | 'workId' | 'concession'>,
): CanvasInfo {
  return { handle, workId, ...dims, concession: null };
}
