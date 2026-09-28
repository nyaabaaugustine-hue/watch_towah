import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The machine has a `package-lock.json` one level above the project, which
   * makes Next infer the wrong workspace root and trace dependencies from the
   * wrong tree. Pinning the root to this directory keeps standalone builds
   * reproducible on Vercel and locally.
   */
  outputFileTracingRoot: process.cwd(),

  // The Cloudinary and Mapbox SDKs are both large; keep them out of the
  // server-component graph so a slow cold start on a Ghanaian mobile network
  // is not spent shipping code the dashboard never renders.
  serverExternalPackages: ["bcryptjs", "web-push", "cloudinary"],

  async headers() {
    return [
      {
        // The worker must never be cached by a CDN, or a deploy can leave phones
        // running a worker that references assets which no longer exist.
        // `no-cache` still allows revalidation, which makes the update atomic.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
      {
        // The manifest changes rarely and is tiny, but a stale one keeps an old
        // icon on somebody's home screen after a rebrand.
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
