import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import './app.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('No #root element in index.html — the app cannot mount.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
