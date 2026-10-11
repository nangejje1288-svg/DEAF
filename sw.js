"use strict";

const CACHE_NAME = "sharine-static-v1";
const APP_SHELL = [
    "/",
    "/manifest.webmanifest",
    "/icon.svg",
    "/images/image_92e6fca0.jpeg",
    "/images/image_7c4f34c7.jpg"
];

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys
                .filter((key) => key !== CACHE_NAME)
                .map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const requestUrl = new URL(event.request.url);
    if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin) {
        return;
    }

    const isNavigation = event.request.mode === "navigate";
    const isAppAsset = APP_SHELL.includes(requestUrl.pathname);
    if (!isNavigation && !isAppAsset) {
        return;
    }

    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        if (isNavigation) {
            try {
                const fresh = await fetch(event.request);
                if (fresh.ok) {
                    await cache.put("/", fresh.clone());
                }
                return fresh;
            } catch (error) {
                const cached = await cache.match("/");
                if (cached) {
                    return cached;
                }
                throw error;
            }
        }

        const cached = await cache.match(event.request);
        if (cached) {
            return cached;
        }
        const fresh = await fetch(event.request);
        if (fresh.ok && isAppAsset) {
            await cache.put(event.request, fresh.clone());
        }
        return fresh;
    })());
});
