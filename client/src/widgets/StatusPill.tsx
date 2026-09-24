import type { ViewSync } from './ViewerChrome';

export function StatusPill({ view }: { view: ViewSync | null }): JSX.Element {
  const px = view?.px ?? null;
  return (
    <div
      className="glass-pill"
      style={{
        position: 'absolute', left: 16, bottom: 100, maxWidth: 'calc(100% - 248px)',
        overflow: 'hidden', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center',
        gap: 12, height: 48, padding: '0 18px', borderRadius: 24,
        fontSize: 13, color: '#C5C6D0', fontVariantNumeric: 'tabular-nums', pointerEvents: 'none',
      }}
    >
      {px ? (
        <>
          <span style={{ display: 'flex', gap: 6 }}><span style={{ color: '#8F909A' }}>X</span><span style={{ color: '#E3E1E9', minWidth: 44 }}>{px.x}</span></span>
          <span style={{ display: 'flex', gap: 6 }}><span style={{ color: '#8F909A' }}>Y</span><span style={{ color: '#E3E1E9', minWidth: 44 }}>{px.y}</span></span>
          {px.hex ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 16, height: 16, borderRadius: '50%', background: px.hex, boxShadow: '0 0 0 2px #45464F' }} />
              <span style={{ color: '#E3E1E9', fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12 }}>{px.hex}</span>
            </span>
          ) : null}
        </>
      ) : (
        <span>Wheel to zoom · drag to pan · double click to dive in</span>
      )}
    </div>
  );
}
