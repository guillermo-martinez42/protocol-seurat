export const ENDPOINTS = {
  sesion: '/seurat/v1/sesion',
} as const;

export const LIMITS = {
  wtReadyMs: 3000,
  miradaPerSec: 20,
  quietaIdleMs: 300,
  reciboMs: 100,
  reciboBatch: 8,
  memMibFallback: 128,
} as const;

export const CLIENT_NAME = 'visor/2.0';
