import { useEffect } from 'react';
import { parseOpenHash } from '@/features/open-work';
import { patchUi, useUi, getUi } from './store';

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

let galleryScrollY = 0;

/** Keeps the library scroll position while the viewer is open. */
export function rememberGalleryScroll(): void {
  galleryScrollY = window.scrollY;
}

export function galleryScroll(): number {
  return galleryScrollY;
}

export function goViewer(id: string): void {
  if (getUi().route.name === 'gallery') rememberGalleryScroll();
  window.location.hash = '#/visor/' + encodeURIComponent(id);
  patchUi({ route: { name: 'viewer', id }, menu: false });
}
