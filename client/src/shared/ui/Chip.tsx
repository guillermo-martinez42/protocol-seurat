import type { CSSProperties, ReactNode } from 'react';
import styles from './Chip.module.css';

interface Props {
  children: ReactNode;
  onClick?: () => void;
  on: boolean;
  style?: CSSProperties;
}

export function Chip({ children, onClick, on, style }: Props): JSX.Element {
  const cls = on ? `${styles.chip} ${styles.on}` : styles.chip;
  return (
    <button onClick={onClick} className={cls} style={style}>
      {children}
    </button>
  );
}
