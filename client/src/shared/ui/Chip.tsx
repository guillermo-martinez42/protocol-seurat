import type { CSSProperties, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onClick?: () => void;
  on: boolean;
  style?: CSSProperties;
}

export function Chip({ children, onClick, on, style }: Props): JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, height: 40,
        padding: on ? '0 18px 0 12px' : '0 18px',
        border: on ? 'none' : '1px solid #C5C6D0',
        borderRadius: on ? 12 : 20,
        background: on ? '#DEE1F9' : 'transparent',
        color: on ? '#171B2C' : '#45464F',
        fontSize: 14, fontWeight: on ? 600 : 500, cursor: 'pointer', ...style,
      }}
    >
      {children}
    </button>
  );
}
