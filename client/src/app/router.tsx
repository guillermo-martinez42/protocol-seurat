import { useEffect } from 'react';
import { parseOpenHash } from '@/features/open-work';
import { patchUi, useUi } from './store';

export function useHashRoute(): void {
  const ui = useUi();
  useEffect(() => {
    const sync = (): void => {
      const id = parseOpenHash(window.location.hash);
      if (id) {
        if (ui.route.name !== 'viewer' || ui.route.id !== id) patchUi({ route: { name: 'viewer', id } });
      } else if (ui.route.name !== 'gallery') {
        patchUi({ route: { name: 'gallery' } });
      }
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [ui.route]);
}

export function goGallery(): void {
  window.location.hash = '#/';
  patchUi({ route: { name: 'gallery' }, menu: false });
}

export function goViewer(id: string): void {
  window.location.hash = '#/visor/' + encodeURIComponent(id);
  patchUi({ route: { name: 'viewer', id }, menu: false });
}
