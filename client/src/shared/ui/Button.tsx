import type { CSSProperties, ReactNode } from 'react';
import styles from './Button.module.css';

interface Props {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  style?: CSSProperties;
  activeStyle?: 'pill' | 'flat';
}

export function Button({ children, onClick, title, style, activeStyle }: Props): JSX.Element {
  const cls = activeStyle === 'pill' ? `${styles.button} ${styles.pill}` : styles.button;
  return (
    <button onClick={onClick} title={title} className={cls} style={style}>
      {children}
    </button>
  );
}
