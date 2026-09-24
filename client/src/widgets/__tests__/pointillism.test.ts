import { describe, expect, it } from 'vitest';
import { drawPointillism, samplePixelHex, type PointillismBrush } from '../pointillism';

function createMockScratchCanvas(pixels: Uint8ClampedArray, w: number, h: number): HTMLCanvasElement {
  const mockCtx = {
    imageSmoothingEnabled: true,
    clearRect: () => {},
    drawImage: () => {},
    getImageData: () => ({ data: pixels, width: w, height: h }),
  };
  return {
    width: w,
    height: h,
    getContext: () => mockCtx,
  } as unknown as HTMLCanvasElement;
}

describe('pointillism widget', () => {
  it('does nothing when brushes array is empty or zoom <= 0', () => {
    let arcCount = 0;
    const ctx = {
      beginPath: () => {},
      arc: () => { arcCount++; },
      fill: () => {},
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D;

    const scratch = createMockScratchCanvas(new Uint8ClampedArray(16), 2, 2);

    drawPointillism(ctx, {
      tx: 0, ty: 0, s: 16, cx0: 0, cy0: 0, cx1: 100, cy1: 100,
      iw: 100, ih: 100, f: 1, brushes: [], scratchCanvas: scratch,
    });
    expect(arcCount).toBe(0);

    drawPointillism(ctx, {
      tx: 0, ty: 0, s: 0, cx0: 0, cy0: 0, cx1: 100, cy1: 100,
      iw: 100, ih: 100, f: 1,
      brushes: [{ x: 0, y: 0, w: 100, h: 100, bmp: {} as ImageBitmap }],
      scratchCanvas: scratch,
    });
    expect(arcCount).toBe(0);
  });

  it('draws circular dots for visible non-transparent pixels', () => {
    const dots: Array<{ cx: number; cy: number; rad: number; color: string }> = [];
    let currentColor = '';
    const ctx = {
      beginPath: () => {},
      arc: (cx: number, cy: number, rad: number) => {
        dots.push({ cx, cy, rad, color: currentColor });
      },
      fill: () => {},
      set fillStyle(val: string) { currentColor = val; },
    } as unknown as CanvasRenderingContext2D;

    // 2x1 image with red and blue pixels
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255,   // red
      0, 0, 255, 255,   // blue
    ]);
    const scratch = createMockScratchCanvas(pixels, 2, 1);

    const brush: PointillismBrush = {
      x: 0, y: 0, w: 2, h: 1,
      bmp: {} as ImageBitmap,
    };

    drawPointillism(ctx, {
      tx: 0, ty: 0, s: 16, cx0: 0, cy0: 0, cx1: 32, cy1: 16,
      iw: 2, ih: 1, f: 1, brushes: [brush], scratchCanvas: scratch,
    });

    expect(dots.length).toBe(2);
    expect(dots[0]?.color).toBe('rgb(255,0,0)');
    expect(dots[1]?.color).toBe('rgb(0,0,255)');
    expect(dots[0]?.rad).toBeGreaterThan(0);
    expect(dots[1]?.rad).toBeGreaterThan(0);
  });

  it('skips pixels with 0 alpha (transparent)', () => {
    let dotCount = 0;
    const ctx = {
      beginPath: () => {},
      arc: () => { dotCount++; },
      fill: () => {},
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D;

    const pixels = new Uint8ClampedArray([
      0, 0, 0, 0,       // transparent
      255, 255, 255, 0, // transparent
    ]);
    const scratch = createMockScratchCanvas(pixels, 2, 1);

    drawPointillism(ctx, {
      tx: 0, ty: 0, s: 16, cx0: 0, cy0: 0, cx1: 32, cy1: 16,
      iw: 2, ih: 1, f: 1,
      brushes: [{ x: 0, y: 0, w: 2, h: 1, bmp: {} as ImageBitmap }],
      scratchCanvas: scratch,
    });

    expect(dotCount).toBe(0);
  });

  it('samplePixelHex samples the finest covering brush pixel in uppercase hex', () => {
    let drawn = false;
    const mockCtx = {
      imageSmoothingEnabled: true,
      drawImage: () => { drawn = true; },
      getImageData: () => ({ data: new Uint8ClampedArray([18, 52, 86, 255]) }),
    };
    const scratch = {
      width: 0,
      height: 0,
      getContext: () => mockCtx,
    } as unknown as HTMLCanvasElement;

    const brushes: PointillismBrush[] = [
      { x: 0, y: 0, w: 100, h: 100, bmp: { width: 100, height: 100 } as unknown as ImageBitmap },
      { x: 10, y: 10, w: 20, h: 20, bmp: { width: 20, height: 20 } as unknown as ImageBitmap },
    ];

    const hex = samplePixelHex(brushes, 15, 15, scratch);
    expect(drawn).toBe(true);
    expect(hex).toBe('#123456');

    // Out of bounds
    const outside = samplePixelHex(brushes, 999, 999, scratch);
    expect(outside).toBeNull();
  });
});
