import { describe, expect, it } from 'vitest';
import { receiverWindow } from '@/entities/delivery/credit';

describe('receiverWindow (RECIBO.libre)', () => {
  it('keeps about one second of brushes on a 512 kbit/s link', () => {
    expect(receiverWindow(768, 64_000, 26_000)).toBe(3);
  });

  it('never drops below two, so one brush arrives while the next is confirmed', () => {
    expect(receiverWindow(768, 4_000, 26_000)).toBe(2);
  });

  it('leaves fast links bound only by client memory', () => {
    expect(receiverWindow(768, 25_000_000, 30_000)).toBe(768);
  });

  it('uses the memory window before the link is measured, and never exceeds it', () => {
    expect(receiverWindow(768, 0, 26_000)).toBe(768);
    expect(receiverWindow(1, 64_000, 26_000)).toBe(1);
  });
});
