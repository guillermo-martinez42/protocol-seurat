import { useEffect, useRef } from 'react';
import { hash3 } from '@/shared/lib/hash3';
import { clamp } from '@/shared/lib/clamp';
import { Icon } from '@/shared/ui/Icon';

const CELL = 11;

export function GalleryHero({ onOpen }: { onOpen: () => void }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let raf = 0;
    const ro = new ResizeObserver(() => tick());
    ro.observe(canvas);
    const start = performance.now();
    const sample = makeSample();
    function tick(): void {
      cancelAnimationFrame(raf);
      const c = ref.current;
      if (!c) return;
      const r = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const W = Math.round(r.width * dpr);
      const H = Math.round(r.height * dpr);
      if (W === 0 || H === 0) return;
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      const cols = Math.ceil(r.width / CELL) + 1;
      const rows = Math.ceil(r.height / CELL) + 1;
      const k = Math.max(cols / sample.w, rows / sample.h);
      const ox = (sample.w * k - cols) / 2;
      const oy = (sample.h * k - rows) / 2;
      const t = (performance.now() - start) / 1000;
      let busy = false;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const [h1, h2, h3] = hash3(x, y);
          const p = clamp((t - (1 - x / cols) * 0.7 - h3 * 0.45) / 0.55, 0, 1);
          if (p < 1) busy = true;
          if (p <= 0) continue;
          const q = p - 1;
          const e = 1 + 2.70158 * q * q * q + 1.70158 * q * q;
          const sx = clamp(Math.floor((x + ox) / k), 0, sample.w - 1);
          const sy = clamp(Math.floor((y + oy) / k), 0, sample.h - 1);
          const i = (sy * sample.w + sx) * 4;
          ctx.fillStyle = 'rgb(' + sample.d[i] + ',' + sample.d[i + 1] + ',' + sample.d[i + 2] + ')';
          ctx.beginPath();
          ctx.arc(
            (x + 0.5 + (h1 - 0.5) * 0.35) * CELL,
            (y + 0.5 + (h2 - 0.5) * 0.35) * CELL,
            Math.max(0, CELL * (0.26 + 0.2 * h3) * e),
            0, 6.2832,
          );
          ctx.fill();
        }
      }
      if (busy) raf = requestAnimationFrame(tick);
    }
    tick();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <section
      onClick={onOpen}
      style={{ position: 'relative', overflow: 'hidden', borderRadius: 48, background: '#DDE1FF', minHeight: 420, display: 'flex', alignItems: 'flex-end', cursor: 'zoom-in' }}
    >
      <canvas ref={ref} style={{ position: 'absolute', top: 0, right: 0, width: '70%', height: '100%', display: 'block', maskImage: 'linear-gradient(to right,transparent 0%,#000 42%)', WebkitMaskImage: 'linear-gradient(to right,transparent 0%,#000 42%)' }} />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 22, padding: 56, maxWidth: 660 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 14px 0 10px', borderRadius: 16, background: '#FBF8FF', color: '#00105C', fontSize: 14, fontWeight: 600 }}>
          <Icon name="blur_on" size={20} />Deep zoom viewer
        </span>
        <h1 style={{ margin: 0, fontSize: 'clamp(60px,9vw,128px)', lineHeight: 0.9, fontWeight: 800, fontVariationSettings: "'wdth' 118, 'opsz' 144", letterSpacing: '-0.04em', color: '#00105C' }}>Look closer.</h1>
        <p style={{ margin: 0, maxWidth: 440, fontSize: 18, lineHeight: 1.5, color: '#2A2F52' }}>Built for massive images. Scroll to zoom, drag to pan — keep zooming in and every pixel becomes a dot.</p>
        <button className="hero-btn">
          Open Plate 01<Icon name="arrow_forward" size={22} />
        </button>
      </div>
      <span style={{ position: 'absolute', right: 24, bottom: 24, display: 'flex', alignItems: 'center', height: 32, padding: '0 14px', borderRadius: 16, background: 'rgba(251,248,255,0.92)', color: '#1A1B21', fontSize: 13, fontWeight: 500 }}>Plate 01 · one dot per sampled pixel</span>
    </section>
  );
}

function makeSample(): { d: Uint8ClampedArray; w: number; h: number } {
  const w = 240;
  const h = 160;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = Math.round(120 + 90 * Math.sin(x / 18) * Math.cos(y / 22));
      d[i + 1] = Math.round(130 + 70 * Math.sin((x + y) / 26));
      d[i + 2] = Math.round(200 + 40 * Math.cos(x / 14 - y / 30));
      d[i + 3] = 255;
    }
  }
  return { d, w, h };
}
