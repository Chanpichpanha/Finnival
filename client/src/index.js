// Suppress third-party browser extension errors (Brave/Firefox/MetaMask injected scripts)
if (typeof window !== 'undefined') {
  const ignorePatterns = ['__firefox__', 'ethereum', 'refresh_youtube_quality', 'selectedAddress'];
  const originalOnError = window.onerror;
  window.onerror = function (msg, source, lineno, colno, error) {
    const isSanitizedScriptError =
      msg === 'Script error.' ||
      msg === 'Script error' ||
      (!source && !lineno && !error);
    if (isSanitizedScriptError || (typeof msg === 'string' && ignorePatterns.some((p) => msg.includes(p)))) {
      return true; // suppresses the error
    }
    if (originalOnError) return originalOnError.apply(this, arguments);
  };
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppAuthProvider } from './auth/AuthContext';
import App from './App';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <AppAuthProvider>
    <App />
  </AppAuthProvider>
);
