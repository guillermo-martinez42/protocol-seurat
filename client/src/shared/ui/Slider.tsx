import { useRef } from 'react';
import { clamp } from '@/shared/lib/clamp';

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
      style={{ position: 'relative', width: 168, height: 48, cursor: 'pointer', touchAction: 'none' }}
    >
      <div style={{ position: 'absolute', left: 0, top: 16, height: 16, width: 'max(0px, calc(' + pct + '% - 8px))', borderRadius: '8px 4px 4px 8px', background: '#B8C4FF' }} />
      <div style={{ position: 'absolute', left: 'calc(' + pct + '% - 2px)', top: 4, width: 4, height: 40, borderRadius: 2, background: '#B8C4FF' }} />
      <div style={{ position: 'absolute', left: 'min(100%, calc(' + pct + '% + 8px))', right: 0, top: 16, height: 16, borderRadius: '4px 8px 8px 4px', background: '#414659' }} />
    </div>
  );
}
