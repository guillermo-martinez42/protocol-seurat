import type { Concesion } from '@/shared/proto/messages';

export interface LienzoInfo {
  handle: number;
  obraId: string;
  ancho: number;
  alto: number;
  estratos: number;
  edicion: number;
  techoEstrato: number;
  techoBandas: number;
  semillaAncho: number;
  semillaAlto: number;
  concesion: Concesion | null;
}

export function permite(c: Concesion, s: number, b1: number): boolean {
  if (s > c.estratoMin) return true;
  if (s === c.estratoMin) return b1 <= c.bandasMax;
  return false;
}

export function makeLienzo(
  handle: number,
  obraId: string,
  dims: Omit<LienzoInfo, 'handle' | 'obraId' | 'concesion'>,
): LienzoInfo {
  return { handle, obraId, ...dims, concesion: null };
}
