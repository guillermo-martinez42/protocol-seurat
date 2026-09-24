import { Icon } from '@/shared/ui/Icon';

export interface InfoRow {
  k: string;
  v: string;
}

const KEYS = [
  { a: 'Zoom at cursor', k: 'Wheel / pinch' },
  { a: 'Pan', k: 'Drag / arrows' },
  { a: 'Dive in', k: 'Double click' },
  { a: 'Zoom in / out', k: '+ / −' },
  { a: 'Fit to screen', k: '0' },
  { a: 'Actual pixels', k: '1' },
  { a: 'Loupe', k: 'L' },
  { a: 'Pointillist pixels', k: 'P' },
  { a: 'Previous / next', k: '[ ]' },
  { a: 'Back to library', k: 'Esc' },
];

export function ViewerInfoPanel({ rows, onClose }: { rows: InfoRow[]; onClose(): void }): JSX.Element {
  return (
    <aside style={{ position: 'absolute', top: 88, right: 16, bottom: 284, width: 320, maxWidth: 'calc(100% - 32px)', overflow: 'auto', padding: 24, borderRadius: 28, background: '#1A1B21', boxShadow: '0 12px 32px rgba(0,0,0,0.45)', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 22, fontWeight: 700, fontVariationSettings: "'wdth' 115" }}>Details</span>
        <button onClick={onClose} className="visor-btn" style={{ width: 40, height: 40, borderRadius: 20, background: '#292A2F', color: '#E3E1E9' }}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map((r) => (
          <div key={r.k} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 14 }}>
            <span style={{ color: '#8F909A' }}>{r.k}</span>
            <span style={{ color: '#E3E1E9', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.v}</span>
          </div>
        ))}
      </div>
      <div style={{ height: 1, background: '#34343A' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 650, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#B8C4FF' }}>Shortcuts</span>
        {KEYS.map((k) => (
          <div key={k.a} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
            <span style={{ color: '#C5C6D0' }}>{k.a}</span>
            <span style={{ padding: '3px 10px', borderRadius: 8, background: '#292A2F', color: '#E3E1E9', fontSize: 12, fontWeight: 600 }}>{k.k}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
