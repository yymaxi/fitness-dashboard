import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerSW } from 'virtual:pwa-register';
import { initSync } from './sync/controller';
import './index.css';

// Offline-Fähigkeit: neue Versionen werden im Hintergrund geladen und beim nächsten Start aktiv
registerSW({ immediate: true });
// Rückkehr von Dropbox (?code=…): direkt auf der Sync-Seite landen, dann Code einlösen
if (/[?&](code|error)=/.test(location.search)) history.replaceState(null, '', `${location.pathname}${location.search}#/daten`);
void initSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
