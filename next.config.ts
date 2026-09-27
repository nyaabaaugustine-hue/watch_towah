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
};

export default nextConfig;
