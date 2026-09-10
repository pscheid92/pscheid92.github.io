// Self-destructing replacement for the former /cpr offline service worker.
//
// The CPR metronome page was folded into /cpr-trainer. Browsers that installed
// the old worker would otherwise keep serving the cached /cpr/ page offline
// forever, so this version clears its caches, unregisters itself and reloads
// any open /cpr/ tab so it picks up the redirect from the network.
// Keep this file for a few months, then it can be removed.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();
            await Promise.all(keys.filter((k) => k.startsWith('cpr-')).map((k) => caches.delete(k)));
            await self.clients.claim();
            await self.registration.unregister();
            const clients = await self.clients.matchAll({type: 'window'});
            await Promise.all(clients.map((c) => c.navigate(c.url).catch(() => {})));
        })(),
    );
});
