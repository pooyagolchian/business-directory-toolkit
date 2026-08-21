import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Google listing thumbnails.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "lh5.googleusercontent.com" },
      { protocol: "https", hostname: "streetviewpixels-pa.googleapis.com" },
    ],
  },
  // The origin is us-east-1 and the audience is in Dubai, ~250ms away. Anything
  // that forces an origin hit on a normal pageview is a bug, not a nit.
  // See docs/adr/0003-deploy-region.md.
  poweredByHeader: false,

  /**
   * @directory/core ships TypeScript source with .js-suffixed imports, which is
   * correct for Node ESM but needs Next to transpile it rather than treat it as
   * a prebuilt dependency.
   */
  transpilePackages: ["@directory/core"],

  /**
   * Without this the crawl output is not bundled into the server function and
   * the deployed site renders its empty state. `.data` is produced by
   * scripts/bundle-data.mjs at prebuild.
   */
  outputFileTracingIncludes: {
    "/**": [".data/**"],
  },
};

export default nextConfig;
