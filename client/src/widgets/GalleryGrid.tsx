import { useEffect, useRef } from 'react';
import { hash3 } from '@/shared/lib/hash3';
import { useWorkPreview } from '@/entities/work';
import { drawScaledRgba } from '@/shared/codec/seed';
import type { Work } from '@/entities/work/types';
import { workDims, workTitle } from '@/entities/work/types';
import type { Filter } from '@/entities/work/store';
import { Icon } from '@/shared/ui/Icon';

function Thumb({ work }: { work: Work }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const preview = useWorkPreview(work.id);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const maxDim = 144;
    const ar = work.height > 0 ? work.width / work.height : 1;
    const w = ar >= 1 ? maxDim : Math.max(32, Math.round(maxDim * ar));
    const h = ar >= 1 ? Math.max(32, Math.round(maxDim / ar)) : maxDim;
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    if (preview) {
      drawScaledRgba(ctx, preview.rgba, preview.width, preview.height, w, h);
      return;
    }

    const img = ctx.createImageData(w, h);
    let seed = 0;
    for (const ch of work.id) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [a, b, cc] = hash3(x + seed, y - seed);
        const i = (y * w + x) * 4;
        img.data[i] = Math.round(90 + 120 * a);
        img.data[i + 1] = Math.round(100 + 100 * b);
        img.data[i + 2] = Math.round(170 + 70 * cc);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [work, preview]);

  return <canvas ref={ref} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />;
}

interface Props {
  items: Work[];
  filter: Filter;
  onFilter: (f: Filter) => void;
  onOpen: (id: string) => void;
}

const CHIPS: Array<[Filter, string]> = [['all', 'All'], ['landscape', 'Landscape'], ['portrait', 'Portrait']];

export function GalleryGrid({ items, filter, onFilter, onOpen }: Props): JSX.Element {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {CHIPS.map(([k, label]) => {
            const on = filter === k;
            return (
              <button
                key={k}
                onClick={() => onFilter(k)}
                className={on ? undefined : 'chip-off'}
                style={on
                  ? { display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 18px 0 12px', border: 'none', borderRadius: 12, background: '#DEE1F9', color: '#171B2C', fontSize: 14, fontWeight: 600, cursor: 'pointer' }
                  : undefined}
              >
                {on ? <Icon name="check" size={18} /> : null}{label}
              </button>
            );
          })}
        </div>
        <span style={{ fontSize: 14, color: '#45464F' }}>{items.length} images</span>
      </div>
      <div style={{ columns: '300px', columnGap: 24 }}>
        {items.map((w, i) => (
          <div
            key={w.id}
            onClick={() => onOpen(w.id)}
            className="gallery-card"
            style={{ breakInside: 'avoid', pageBreakInside: 'avoid', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32, cursor: 'zoom-in' }}
          >
            <div className="gallery-card-thumb" style={{ aspectRatio: `${w.width} / ${w.height}` }}>
              <Thumb work={w} />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '0 10px' }}>
              <span style={{ fontSize: 17, fontWeight: 650, fontVariationSettings: "'wdth' 112" }}>{workTitle(w, i)}</span>
              <span style={{ fontSize: 13, color: '#45464F', fontVariantNumeric: 'tabular-nums' }}>{workDims(w)}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
