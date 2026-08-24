// Offline support for /cpr — the CPR metronome must work without a network.
// Scope is limited to /cpr; the rest of the site is not touched.
const CACHE = 'cpr-v1';
const STATIC_ASSETS = [
    '/fonts/atkinson-regular.woff',
    '/fonts/atkinson-bold.woff',
    '/favicon.svg',
    '/favicon.ico',
];

// Precache the page and everything it references, so a single online visit
// is enough. Asset URLs are parsed from the HTML because Astro hashes them.
self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE);
            const response = await fetch('/cpr/');
            await cache.put('/cpr/', response.clone());
            const html = await response.text();

            const assets = new Set(STATIC_ASSETS);
            for (const match of html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css|woff2?|webp|png|svg|ico))"/g)) {
                assets.add(match[1]);
            }
            await cache.addAll([...assets]);
            await self.skipWaiting();
        })(),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();
            await Promise.all(
                keys.filter((key) => key.startsWith('cpr-') && key !== CACHE).map((key) => caches.delete(key)),
            );
            await self.clients.claim();
        })(),
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) {
        return;
    }

    // The page itself: network-first so updates arrive, cache when offline.
    // Scope is a prefix match, so siblings like /cpr-trainer also land here —
    // only the metronome page itself may be cached under the /cpr/ key.
    if (request.mode === 'navigate') {
        const path = new URL(request.url).pathname;
        if (path !== '/cpr' && path !== '/cpr/') {
            return;
        }
        event.respondWith(
            (async () => {
                try {
                    const response = await fetch(request);
                    // only cache clean documents — never redirects, so the
                    // offline fallback can't end up in a redirect loop
                    if (response.ok && !response.redirected) {
                        const cache = await caches.open(CACHE);
                        await cache.put('/cpr/', response.clone());
                    }
                    return response;
                } catch {
                    return (await caches.match('/cpr/')) || Response.error();
                }
            })(),
        );
        return;
    }

    // Subresources (hashed JS/CSS, fonts, images): cache-first, fill from network.
    event.respondWith(
        (async () => {
            const cached = await caches.match(request);
            if (cached) {
                return cached;
            }
            const response = await fetch(request);
            if (response.ok) {
                const cache = await caches.open(CACHE);
                await cache.put(request, response.clone());
            }
            return response;
        })(),
    );
});
