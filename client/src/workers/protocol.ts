export interface SynthRequest {
  delivery: number;
  stratum: number;
  qY: number;
  qC: number;
  seed: boolean;
  semillaAncho: number;
  semillaAlto: number;
  bands: ArrayBuffer[];
}

export interface SynthResult {
  delivery: number;
  ok: boolean;
  error?: string;
  rgba: ArrayBuffer | null;
  width: number;
  height: number;
  elapsedMs: number;
}

export type WorkerIn = SynthRequest;
export type WorkerOut = SynthResult;
