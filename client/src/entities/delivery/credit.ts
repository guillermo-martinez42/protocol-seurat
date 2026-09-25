import { CREDIT_MIN, CREDIT_WINDOW_S } from '@/shared/config/constants';

/**
 * RECIBO.libre: the memory window, capped to about CREDIT_WINDOW_S of deliveries at the
 * measured link rate. Unmeasured links get the memory window (the server starts at 8).
 */
export function receiverWindow(memory: number, linkBps: number, avgDelivery: number): number {
  if (linkBps <= 0 || avgDelivery <= 0) return memory;
  return Math.min(memory, Math.max(CREDIT_MIN, Math.ceil((linkBps * CREDIT_WINDOW_S) / avgDelivery)));
}
