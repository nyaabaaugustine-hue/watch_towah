"use client";

import { useEffect } from "react";

/**
 * Registers `public/sw.js`.
 *
 * The service worker, the manifest, and the icons were all present and served
 * correctly, but nothing ever called `navigator.serviceWorker.register`. The
 * whole offline layer was therefore inert: a phone that lost signal got a
 * browser error page instead of the offline screen, and no navigation or static
 * asset was ever served from a cache. This is the only place the file becomes
 * active.
 *
 * Production only, deliberately. The worker is cache-first for `/_next/static/`,
 * and in development those URLs are not content-hashed, so registering it there
 * serves stale chunks and the app stops hot-reloading. That trade is worth it:
 * a development cache that lies about the current build is far more annoying
 * than waiting for a real build to test offline behaviour.
 */
export const ServiceWorkerRegistration = () => {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }

    if (!("serviceWorker" in navigator)) {
      return;
    }

    // `load` rather than mount: registration competes with the app shell for
    // bandwidth, and on a metered connection the first paint matters more.
    const register = (): void => {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((cause: unknown) => {
        // Not fatal. The app works without it; only the offline fallback is
        // lost, and a failed registration should never break the first render.
        console.error("service worker registration failed", { cause });
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
};
