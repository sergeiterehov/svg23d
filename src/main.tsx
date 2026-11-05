import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { applyLocalePreference } from './app/i18n';
import { loadLocalePreference } from './app/storage/appSettings';
import './index.css';

// The language is the very first thing applied: the stored preference (or the browser) decides it
// before React paints anything, so the interface never flashes in the wrong language (ADR-0037).
applyLocalePreference(loadLocalePreference());

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root was not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
