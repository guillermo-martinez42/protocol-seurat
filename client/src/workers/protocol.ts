export interface SynthRequest {
  entrega: number;
  estrato: number;
  qY: number;
  qC: number;
  semilla: boolean;
  semillaAncho: number;
  semillaAlto: number;
  bands: ArrayBuffer[];
}

export interface SynthResult {
  entrega: number;
  ok: boolean;
  error?: string;
  rgba: ArrayBuffer | null;
  ancho: number;
  alto: number;
  elapsedMs: number;
}

export type WorkerIn = SynthRequest;
export type WorkerOut = SynthResult;
