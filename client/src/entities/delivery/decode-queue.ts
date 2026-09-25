/**
 * cola_ms (spec 6.1): synthesis work still inside the worker, measured rather than guessed.
 * Every posted brush gets exactly one reply (ok or error), so the count returns to 0 when idle.
 */
export class DecodeQueue {
  private inWorker = 0;
  private avgMs = 5;

  posted(): void {
    this.inWorker += 1;
  }

  answered(elapsedMs: number): void {
    this.inWorker = Math.max(0, this.inWorker - 1);
    this.avgMs = 0.8 * this.avgMs + 0.2 * elapsedMs;
  }

  get ms(): number {
    return this.inWorker * this.avgMs;
  }
}
