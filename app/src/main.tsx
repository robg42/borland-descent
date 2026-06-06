import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PlayerView } from './player/PlayerView';
import { StudioView } from './studio/StudioView';
import './ui.css';

// Two routes, minimal router: '/' is the player, '/studio' is the studio. They run
// independent engine instances, so a full navigation between them is intentional.
const path = window.location.pathname.replace(/\/+$/, '');
const Root = path.endsWith('/studio') ? StudioView : PlayerView;

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
