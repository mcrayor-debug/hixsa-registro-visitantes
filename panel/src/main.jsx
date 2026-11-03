import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../public/styles.css';
import './panel.css';
import App from './App.jsx';
import { ToastProvider } from './components/ui.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
