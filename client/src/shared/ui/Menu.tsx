import type { ReactNode } from 'react';

interface Props {
  open: boolean;
  children: ReactNode;
}

export function Menu({ open, children }: Props): JSX.Element | null {
  if (!open) return null;
  return (
    <div
      style={{
        position: 'absolute', left: '50%', bottom: 'calc(100% + 18px)', transform: 'translateX(-50%)',
        width: 220, padding: 8, borderRadius: 20, background: '#292A2F',
        boxShadow: '0 12px 32px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: 2,
      }}
    >
      {children}
    </div>
  );
}
