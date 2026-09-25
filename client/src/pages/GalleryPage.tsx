import { useMemo } from 'react';
import { GalleryHero } from '@/widgets/GalleryHero';
import { GalleryGrid } from '@/widgets/GalleryGrid';
import { filterWorks } from '@/entities/work/store';
import { goViewer } from '@/app/router';
import { patchUi, useUi } from '@/app/store';
import { useSeurat } from '@/app/providers/SeuratProvider';
import styles from './GalleryPage.module.css';

function DotMark(): JSX.Element {
  return (
    <div className={styles.dotMark}>
      <span className={styles.dot1} />
      <span className={styles.dot2} />
      <span className={styles.dot3} />
      <span className={styles.dot4} />
      <span className={styles.dot5} />
    </div>
  );
}

export function GalleryPage(): JSX.Element {
  const ui = useUi();
  const { works } = useSeurat();
  const items = useMemo(() => filterWorks(works, ui.filter), [works, ui.filter]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <DotMark />
        <span className={styles.brand}>asynchronous</span>
      </header>
      <main className={styles.main}>
        <GalleryHero
          featuredWorkId={items[0]?.id}
          onOpen={() => {
            const first = items[0];
            if (first) goViewer(first.id);
          }}
        />
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
