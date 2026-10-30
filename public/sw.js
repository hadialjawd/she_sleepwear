// She Sleepwear service worker. It only makes the app installable;
// it does not cache anything, so the app always shows live data.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
