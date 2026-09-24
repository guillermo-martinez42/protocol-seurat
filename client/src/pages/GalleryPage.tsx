import { useMemo } from 'react';
import { GalleryHero } from '@/widgets/GalleryHero';
import { GalleryGrid } from '@/widgets/GalleryGrid';
import { filterWorks } from '@/entities/work/store';
import { goViewer } from '@/app/router';
import { patchUi, useUi } from '@/app/store';
import { useSeurat } from '@/app/providers/SeuratProvider';

function DotMark(): JSX.Element {
  return (
    <div style={{ position: 'relative', width: 36, height: 36, flex: 'none' }}>
      <span style={{ position: 'absolute', left: 2, top: 4, width: 14, height: 14, borderRadius: '50%', background: '#4355B9' }} />
      <span style={{ position: 'absolute', left: 19, top: 2, width: 9, height: 9, borderRadius: '50%', background: '#FF8A5B' }} />
      <span style={{ position: 'absolute', left: 21, top: 15, width: 13, height: 13, borderRadius: '50%', background: '#9A4521' }} />
      <span style={{ position: 'absolute', left: 6, top: 21, width: 10, height: 10, borderRadius: '50%', background: '#B8C4FF' }} />
      <span style={{ position: 'absolute', left: 15, top: 28, width: 6, height: 6, borderRadius: '50%', background: '#4355B9' }} />
    </div>
  );
}

export function GalleryPage(): JSX.Element {
  const ui = useUi();
  const { works } = useSeurat();
  const items = useMemo(() => filterWorks(works, ui.filter), [works, ui.filter]);

  return (
    <div style={{ minHeight: '100vh', background: '#FBF8FF' }}>
      <header style={{ maxWidth: 1440, margin: '0 auto', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <DotMark />
        <span style={{ fontSize: 22, fontWeight: 720, fontVariationSettings: "'wdth' 125", letterSpacing: '-0.01em' }}>asynchronous</span>
      </header>
      <main style={{ maxWidth: 1440, margin: '0 auto', padding: '4px 32px 96px', display: 'flex', flexDirection: 'column', gap: 40 }}>
        <GalleryHero onOpen={() => {
          const first = items[0];
          if (first) goViewer(first.id);
        }} />
        <GalleryGrid
          items={items}
          filter={ui.filter}
          onFilter={(f) => patchUi({ filter: f })}
          onOpen={(id) => goViewer(id)}
        />
      </main>
    </div>
  );
}
