// Suppress third-party browser extension errors (Brave/Firefox/MetaMask injected scripts)
if (typeof window !== 'undefined') {
  const ignorePatterns = ['__firefox__', 'ethereum', 'refresh_youtube_quality', 'selectedAddress'];
  const originalOnError = window.onerror;
  window.onerror = function (msg) {
    if (typeof msg === 'string' && ignorePatterns.some((p) => msg.includes(p))) {
      return true; // suppresses the error
    }
    if (originalOnError) return originalOnError.apply(this, arguments);
  };
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
