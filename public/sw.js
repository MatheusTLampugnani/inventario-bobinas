// Service Worker do Inventário de Bobinas.
//
// Estratégias:
//   - Navegação (index.html): rede primeiro, cache como reserva. Um deploy novo aparece na hora
//     quando há rede, e sem rede o app ainda abre.
//   - Arquivos com hash do Vite (/assets/*): cache primeiro. O nome muda a cada build, então
//     o conteúdo de um nome nunca muda. Os do index.html atual são guardados já na instalação.
//   - Demais arquivos estáticos: cache com revalidação em segundo plano.
//   - Requisições que não são GET, de outra origem, fora do app (ex.: /acesso/, o Portal que diz quem
//     está logado) ou da API (/drone-api) não são interceptadas.
const CACHE_NAME = 'inv-bobinas-v8';
const ASSETS = [
  './',
  './index.html',
  './favicon.ico',
  './manifest.json',
  './pwa-192x192.png',
  './pwa-512x512.png'
];

const INDEX_URL = new URL('./index.html', self.location).href;
const SCOPE_URL = new URL('./', self.location).href;
const SCOPE_PATH = new URL(SCOPE_URL).pathname;

// JS/CSS referenciados pelo index.html (ex.: /bobinas/assets/index-AbC123.js)
const assetsDoIndex = (html) => [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+\.(?:js|css))"/g)]
  .map((m) => new URL(m[1], self.location).href);

// Remove do cache os JS/CSS de builds anteriores
const podarAssetsAntigos = async (html) => {
  const atuais = new Set(assetsDoIndex(html));
  if (atuais.size === 0) return;
  const cache = await caches.open(CACHE_NAME);
  const chaves = await cache.keys();
  await Promise.all(chaves
    .filter((req) => /\/assets\/.+\.(js|css)$/.test(new URL(req.url).pathname) && !atuais.has(req.url))
    .map((req) => cache.delete(req)));
};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS);
    try {
      const index = await cache.match(INDEX_URL);
      if (index) await cache.addAll(assetsDoIndex(await index.text()));
    } catch {
      // Sem problema: os assets entram no cache quando a página os pedir
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : undefined))
    ))
  );
  self.clients.claim();
});

const guardarNoCache = (chave, response) => {
  if (response && response.status === 200 && response.type === 'basic') {
    const copia = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(chave, copia));
  }
  return response;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE_PATH)) return;
  if (url.pathname.includes('/drone-api')) return;

  // Navegação: rede primeiro (deploy novo na hora), cache se estiver sem rede
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.status === 200 && response.type === 'basic') {
          const copia = response.clone();
          event.waitUntil((async () => {
            const html = await copia.clone().text();
            const cache = await caches.open(CACHE_NAME);
            await cache.put(INDEX_URL, copia);
            await podarAssetsAntigos(html);
          })());
        }
        return response;
      } catch {
        return (await caches.match(INDEX_URL)) || (await caches.match(SCOPE_URL)) || Response.error();
      }
    })());
    return;
  }

  // Assets com hash: imutáveis, cache primeiro
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => guardarNoCache(request, response)))
    );
    return;
  }

  // Demais estáticos: responde do cache e atualiza em segundo plano
  event.respondWith(
    caches.match(request).then((cached) => {
      const daRede = fetch(request).then((response) => guardarNoCache(request, response));
      if (cached) {
        daRede.catch(() => {});
        return cached;
      }
      return daRede;
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
