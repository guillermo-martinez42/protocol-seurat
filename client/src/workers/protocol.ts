export interface SynthRequest {
  delivery: number;
  synthesisId: number;
  stratum: number;
  qY: number;
  qC: number;
  seed: boolean;
  seedWidth: number;
  seedHeight: number;
  parentPlanes?: ArrayBuffer[];
  parentPlaneWidth?: number;
  parentPlaneHeight?: number;
  parentX?: number;
  parentY?: number;
  bands: ArrayBuffer[];
}

export interface SynthResult {
  delivery: number;
  synthesisId: number;
  ok: boolean;
  error?: string;
  rgba: ArrayBuffer | null;
  planes: ArrayBuffer[] | null;
  width: number;
  height: number;
  elapsedMs: number;
}

export type WorkerIn = SynthRequest;
export type WorkerOut = SynthResult;
