export interface SessionInfo {
  sessionId: bigint | null;
  ticket: Uint8Array | null;
  caps: number;
  leaseS: number;
  latidoS: number;
  maxEnVuelo: number;
  sesionMaxPinceladas: number;
  lado: number;
}

export const EMPTY_SESSION: SessionInfo = {
  sessionId: null,
  ticket: null,
  caps: 0,
  leaseS: 120,
  latidoS: 15,
  maxEnVuelo: 12,
  sesionMaxPinceladas: 1024,
  lado: 256,
};

const FICHA_KEY = 'seurat.ticket';
const SESION_KEY = 'seurat.sesion';

export function persistResume(sessionId: bigint, ticket: Uint8Array): void {
  try {
    sessionStorage.setItem(SESION_KEY, sessionId.toString());
    sessionStorage.setItem(FICHA_KEY, Array.from(ticket).map((b) => b.toString(16).padStart(2, '0')).join(''));
  } catch {
    /* storage unavailable */
  }
}

export function loadResume(): { sessionId: bigint; ticket: Uint8Array } | null {
  try {
    const s = sessionStorage.getItem(SESION_KEY);
    const f = sessionStorage.getItem(FICHA_KEY);
    if (!s || !f || f.length !== 64) return null;
    const ticket = new Uint8Array(32);
    for (let i = 0; i < 32; i++) ticket[i] = parseInt(f.slice(i * 2, i * 2 + 2), 16);
    return { sessionId: BigInt(s), ticket };
  } catch {
    return null;
  }
}

export function clearResume(): void {
  try {
    sessionStorage.removeItem(SESION_KEY);
    sessionStorage.removeItem(FICHA_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function declareMemMib(): number {
  const dm = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof dm === 'number' && dm > 0) return Math.min(256, Math.floor(dm * 64));
  return 128;
}
