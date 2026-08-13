/* ========================================================
   PRIVATE ALARM - SERVICE WORKER
   --------------------------------------------------------
   Cache-first offline support for the whole app. Bump
   CACHE_VERSION any time a cached file's CONTENT changes
   (index.html, a sound file, etc) so clients pick
   up the new version instead of permanently serving the old
   one. Old versioned caches are removed on activate.

   IMPORTANT: the asset lists below (STATIC_ASSETS, and the
   sound filenames in particular) are duplicated in index.html
   for the "Check Offline Readiness" verification - if you add
   a sound file or a new local asset, update BOTH here and in
   index.html's getRequiredOfflineAssets().
   ======================================================== */

const CACHE_VERSION = "v1";
const CACHE_NAME = `alarm-app-${CACHE_VERSION}`;

const SOUND_FILES = [
    "alarm.mp3",
    "alarm_2.wav",
    "alarm_clock.mp3",
    "boosted_alarm.wav",
    "double_beep.mp3",
    "heavy_ringing.mp3",
    "reflection.mp3",
    "ringing.mp3",
    "ringtone.mp3",
    "timer_alarm.mp3"
];

/*
 * The one external dependency the generator needs at runtime.
 * Cached here so the app never needs a live network request to
 * generate an alarm once prepared - this is exactly as important
 * to offline use as the sound files themselves. jsDelivr sends
 * proper CORS headers, so this fetches as a normal, fully
 * cacheable "cors" response (not an opaque one).
 */
const MP4_MUXER_URL =
    "https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.mjs";

const STATIC_ASSETS = [
    "index.html",
    "manifest.json",
    ...SOUND_FILES.map(name => `sounds/${name}`),
    MP4_MUXER_URL
];


self.addEventListener("install", event => {

    event.waitUntil(
        (async () => {

            const cache = await caches.open(CACHE_NAME);

            /*
             * Cache each asset individually (rather than one
             * cache.addAll call) so that if something fails, we
             * know exactly what - and so a single flaky asset
             * doesn't need to be indistinguishable from "the whole
             * install failed" in the logs.
             */
            const results = await Promise.allSettled(
                STATIC_ASSETS.map(async url => {

                    const response = await fetch(url, { cache: "reload" });

                    if (!response.ok) {
                        throw new Error(`${url} -> HTTP ${response.status}`);
                    }

                    await cache.put(url, response);
                })
            );

            const failures = results
                .map((result, index) =>
                    result.status === "rejected"
                        ? { url: STATIC_ASSETS[index], reason: String(result.reason) }
                        : null
                )
                .filter(Boolean);

            if (failures.length > 0) {

                console.error(
                    "Service worker install: failed to cache these assets:",
                    failures
                );

                /*
                 * Don't skipWaiting/activate a half-cached worker - better
                 * to leave the previous (or no) service worker in control
                 * than silently claim readiness with gaps. The page's own
                 * "Check Offline Readiness" logic will independently detect
                 * and report this too, via the actual cache contents.
                 */
                throw new Error(
                    `Failed to precache ${failures.length} of ` +
                    `${STATIC_ASSETS.length} required assets.`
                );
            }

            self.skipWaiting();
        })()
    );
});


self.addEventListener("activate", event => {

    event.waitUntil(
        (async () => {

            const existingCacheNames = await caches.keys();

            await Promise.all(
                existingCacheNames
                    .filter(name =>
                        name.startsWith("alarm-app-") && name !== CACHE_NAME
                    )
                    .map(name => caches.delete(name))
            );

            await self.clients.claim();
        })()
    );
});


const CACHEABLE_URLS = new Set(
    STATIC_ASSETS.map(url => new URL(url, self.location.href).href)
);


self.addEventListener("fetch", event => {

    const request = event.request;

    if (request.method !== "GET") {
        return;
    }

    const isNavigation = request.mode === "navigate";

    if (!isNavigation && !CACHEABLE_URLS.has(request.url)) {

        /*
         * Not one of our known local/vendored assets, and not a page
         * navigation - leave it to the network untouched. Deliberately
         * NOT caching arbitrary third-party requests.
         */
        return;
    }

    event.respondWith(
        (async () => {

            const cache = await caches.open(CACHE_NAME);

            if (isNavigation) {

                /*
                 * A navigation request's URL (e.g. the site root with no
                 * "index.html" suffix) won't exact-match our cached
                 * "index.html" entry, so always serve that explicitly for
                 * any in-scope navigation rather than relying on an exact
                 * URL match.
                 */
                const cachedPage = await cache.match("index.html");

                if (cachedPage) {
                    return cachedPage;
                }
            }

            const cached = await cache.match(request);

            if (cached) {
                return cached;
            }

            try {

                const response = await fetch(request);

                if (response && response.ok) {
                    cache.put(request, response.clone());
                }

                return response;

            } catch (networkError) {

                if (isNavigation) {

                    const fallback = await cache.match("index.html");

                    if (fallback) {
                        return fallback;
                    }
                }

                throw networkError;
            }
        })()
    );
});
