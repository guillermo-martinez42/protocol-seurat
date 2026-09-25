import { decodeSeed } from '@/shared/codec/seed';
import { parseBrushHead, sliceBands } from '@/shared/proto/brush';
import { hasWorkPreview, setWorkPreview } from '@/entities/work/previews';
import type { WorkOpened } from '@/shared/proto/messages';
import type { SessionClient } from '@/app/providers/session-client';

interface ActivePreview {
  id: string;
  handle: number;
  w: number;
  h: number;
  timer: ReturnType<typeof setTimeout>;
}

export class PreviewManager {
  private queue: string[] = [];
  private active: ActivePreview | null = null;
  private paused = false;

  constructor(private client: () => SessionClient | null) {}

  enqueue(ids: string[]): void {
    for (const id of ids) {
      if (!hasWorkPreview(id) && !this.queue.includes(id) && this.active?.id !== id) {
        this.queue.push(id);
      }
    }
    this.pump();
  }

  pause(): void {
    this.paused = true;
    if (this.active) {
      clearTimeout(this.active.timer);
      if (this.active.handle > 0) this.client()?.closeHandle(this.active.handle);
      this.active = null;
    }
  }

  resume(): void {
    this.paused = false;
    this.pump();
  }

  onWorkOpened(id: string, a: WorkOpened): void {
    if (!this.active || this.active.id !== id) return;
    this.active.handle = a.handle;
    this.active.w = a.seedWidth;
    this.active.h = a.seedHeight;
  }

  onDelivery(bytes: Uint8Array): boolean {
    if (!this.active || this.active.handle === 0) return false;
    let h;
    try {
      h = parseBrushHead(bytes);
    } catch {
      return false;
    }
    if (h.handle !== this.active.handle) return false;
    if (h.delivery === 1 && h.stratum === 10) {
      const { id, handle, w, h: height, timer } = this.active;
      clearTimeout(timer);
      this.active = null;
      void (async () => {
        try {
          const bands = sliceBands(bytes, h);
          const band0 = bands[0];
          if (band0) {
            const decoded = await decodeSeed(band0, w, height);
            setWorkPreview(id, decoded);
          }
        } catch (err) {
          console.warn('Preview decode error for', id, err);
        } finally {
          this.client()?.closeHandle(handle);
          this.pump();
        }
      })();
      return true;
    }
    return true;
  }

  onError(id: string): void {
    if (this.active?.id === id) {
      clearTimeout(this.active.timer);
      if (this.active.handle > 0) this.client()?.closeHandle(this.active.handle);
      this.active = null;
      this.pump();
    }
  }

  private pump(): void {
    if (this.paused || this.active !== null || this.queue.length === 0) return;
    const nextId = this.queue.shift();
    if (!nextId) return;
    if (hasWorkPreview(nextId)) {
      this.pump();
      return;
    }
    const timer = setTimeout(() => {
      if (this.active?.id === nextId) {
        if (this.active.handle > 0) this.client()?.closeHandle(this.active.handle);
        this.active = null;
        this.pump();
      }
    }, 5000);

    this.active = { id: nextId, handle: 0, w: 192, h: 160, timer };
    this.client()?.openPreview(nextId);
  }

  dispose(): void {
    this.pause();
    this.queue = [];
  }
}
