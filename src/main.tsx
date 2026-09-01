import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { shouldReloadForDeployment } from './domain/deploymentVersion.ts';
import './index.css';

const currentBuildVersion = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env?.VITE_APP_VERSION;

async function refreshWhenDeploymentChanges(): Promise<void> {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (!response.ok) return;

    const payload = await response.json() as { version?: string };
    if (shouldReloadForDeployment(currentBuildVersion, payload.version)) {
      window.location.reload();
    }
  } catch {
    // A transient network failure must never interrupt the current session.
  }
}

if (typeof window !== 'undefined') {
  const checkForDeploymentChange = () => { void refreshWhenDeploymentChanges(); };

  window.addEventListener('focus', checkForDeploymentChange);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForDeploymentChange();
  });
  window.setInterval(checkForDeploymentChange, 60_000);
}

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // The app remains fully usable when service workers are unavailable.
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
