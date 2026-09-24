import React from 'react';
import { createRoot } from 'react-dom/client';
import { SeuratProvider } from './app/providers/SeuratProvider';
import { useHashRoute } from './app/router';
import { useUi } from './app/store';
import { GalleryPage } from './pages/GalleryPage';
import { ViewerPage } from './pages/ViewerPage';
import './app/styles/tokens.css';

function Shell(): JSX.Element {
  useHashRoute();
  const ui = useUi();
  if (ui.route.name === 'viewer') return <ViewerPage id={ui.route.id} />;
  return <GalleryPage />;
}

const root = document.getElementById('root');
if (!root) throw new Error('no root element');
createRoot(root).render(
  <React.StrictMode>
    <SeuratProvider>
      <Shell />
    </SeuratProvider>
  </React.StrictMode>,
);
