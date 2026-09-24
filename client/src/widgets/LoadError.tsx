export function LoadError({ onRetry }: { onRetry(): void }): JSX.Element {
  return (
    <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '32px 40px', borderRadius: 28, background: '#1E1F25', textAlign: 'center' }}>
      <span style={{ fontSize: 18, fontWeight: 600 }}>Could not load this image.</span>
      <button onClick={onRetry} style={{ height: 44, padding: '0 24px', border: 'none', borderRadius: 22, background: '#B8C4FF', color: '#1F2D6F', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Retry</button>
    </div>
  );
}
