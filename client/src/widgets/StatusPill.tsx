import type { CSSProperties } from 'react';
import type { ViewSync } from './ViewerChrome';
import styles from './StatusPill.module.css';

export function StatusPill({ view }: { view: ViewSync | null }): JSX.Element {
  const px = view?.px ?? null;
  return (
    <div className={`glass-pill ${styles.pill}`}>
      {px ? (
        <>
          <span className={styles.coordItem}>
            <span className={styles.coordKey}>X</span>
            <span className={styles.coordVal}>{px.x}</span>
          </span>
          <span className={styles.coordItem}>
            <span className={styles.coordKey}>Y</span>
            <span className={styles.coordVal}>{px.y}</span>
          </span>
          {px.hex ? (
            <span className={styles.colorGroup}>
              <span
                className={styles.colorSwatch}
                style={{ '--swatch-color': px.hex } as CSSProperties}
              />
              <span className={styles.hexLabel}>{px.hex}</span>
            </span>
          ) : null}
        </>
      ) : (
        <span>Wheel to zoom · drag to pan · double click to dive in</span>
      )}
    </div>
  );
}
