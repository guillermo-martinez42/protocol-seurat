import type { ReactNode } from 'react';
import styles from './Menu.module.css';

interface Props {
  open: boolean;
  children: ReactNode;
}

export function Menu({ open, children }: Props): JSX.Element | null {
  if (!open) return null;
  return <div className={styles.popover}>{children}</div>;
}
