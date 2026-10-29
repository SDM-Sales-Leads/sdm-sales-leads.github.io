import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { installStorageGuard } from './lib/storageGuard';
import { installApiFetch } from './lib/api';
import { installCairoTime } from './lib/cairoTime';
import { installTelemetry, markReload } from './lib/telemetry';
import { applyTextSize } from './lib/textSize';

// must run before any component reads storage or calls /api
installStorageGuard();
installApiFetch();
installCairoTime();
applyTextSize();
installTelemetry();

// A new version replaces the page files on the server. A tab that was opened before still points at the old file names:
// opening a page that was not loaded yet then fails. Reload once (the new version) instead of showing a blank screen.
// No preventDefault here: it made the import resolve with nothing, and the page then crashed with "Cannot read properties of undefined (reading 'CrmMyDay')".
window.addEventListener('vite:preloadError', (e) => {
  try {
    const last = Number(sessionStorage.getItem('sdm_chunk_reload') || 0);
    if (Date.now() - last > 60_000) { sessionStorage.setItem('sdm_chunk_reload', String(Date.now())); markReload('a page file changed (new version published)'); location.reload(); }
  } catch { location.reload(); }
});

import App from './App.tsx';
import './index.css';
import { initLang } from './i18n/lang';

initLang();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
