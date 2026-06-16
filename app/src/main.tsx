import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { PlayerView } from './player/PlayerView';
import { ErrorBoundary } from './ErrorBoundary';
import './ui.css';

// Two routes, minimal router: '/' is the player, '/studio' is the studio. They run
// independent engine instances, so a full navigation between them is intentional.
// The studio (and its panels) lazy-load: a listener opening the player should never
// pay for the editing surface.
const StudioView = lazy(() =>
  import('./studio/StudioView').then((m) => ({ default: m.StudioView })),
);

const path = window.location.pathname.replace(/\/+$/, '');
const isStudio = path.endsWith('/studio');

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      {isStudio ? (
        <Suspense fallback={<p className="hint" style={{ padding: '2rem' }}>loading studio…</p>}>
          <StudioView />
        </Suspense>
      ) : (
        <PlayerView />
      )}
    </ErrorBoundary>
  </StrictMode>,
);
