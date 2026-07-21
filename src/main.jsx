import 'bootstrap/dist/css/bootstrap.min.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => {
        console.log('Service Worker registrado com sucesso:', reg);

        // Se já existe um Service Worker esperando ativação (ex: aba recarregada antes de aceitar)
        if (reg.waiting) {
          window.dispatchEvent(new CustomEvent('pwa-update-available', { detail: reg }));
        }

        // Se um novo Service Worker for instalado
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // Nova versão carregada e em espera para ativação
                window.dispatchEvent(new CustomEvent('pwa-update-available', { detail: reg }));
              }
            });
          }
        });
      })
      .catch(err => console.error('Erro ao registrar Service Worker:', err));
  });

  // Recarrega a página automaticamente quando o novo service worker assume o controle (skipWaiting)
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}