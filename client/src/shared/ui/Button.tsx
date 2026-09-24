import type { CSSProperties, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  style?: CSSProperties;
  activeStyle?: 'pill' | 'flat';
}

export function Button({ children, onClick, title, style, activeStyle }: Props): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 48, height: 48, display: 'grid', placeItems: 'center', border: 'none',
        borderRadius: activeStyle === 'pill' ? 16 : 24, background: 'transparent',
        color: '#E3E1E9', cursor: 'pointer', ...style,
      }}
    >
      {children}
    </button>
  );
}
