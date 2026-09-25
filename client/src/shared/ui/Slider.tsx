import { useRef, type CSSProperties } from 'react';
import { clamp } from '@/shared/lib/clamp';
import styles from './Slider.module.css';

interface Props {
  frac: number;
  onSeek: (frac: number) => void;
}

export function Slider({ frac, onSeek }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const sliding = useRef(false);
  const pct = (clamp(frac, 0, 1) * 100).toFixed(2);
  const seek = (clientX: number): void => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onSeek(clamp((clientX - r.left) / Math.max(1, r.width), 0, 1));
  };
  return (
    <div
      ref={ref}
      role="slider"
      aria-valuenow={Math.round(clamp(frac, 0, 1) * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      title="Zoom"
      onPointerDown={(e) => {
        sliding.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        seek(e.clientX);
      }}
      onPointerMove={(e) => {
        if (sliding.current) seek(e.clientX);
      }}
      onPointerUp={() => {
        sliding.current = false;
      }}
      onPointerCancel={() => {
        sliding.current = false;
      }}
      className={styles.track}
      style={{ '--pct': `${pct}%` } as CSSProperties}
    >
      <div className={styles.fill} />
      <div className={styles.thumb} />
      <div className={styles.unfill} />
    </div>
  );
}
