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
    /**
     * `assets/**` is the OG card's two vendored .ttf faces. The card is a static
     * segment and is rasterised at build, so today the fonts are only needed by
     * the builder — but the moment anything makes that route dynamic (a
     * per-page card under area/[area]/[l2], say) they have to be inside the
     * Lambda, and the failure is silent: Satori falls back to its own bundled
     * Geist rather than erroring. Tracing them now costs 270 KB and removes a
     * trap. Same class of failure ADR 0009 documents for the dataset.
     */
    "/**": [".data/**", "assets/**"],
  },

  /**
   * The OG card is a static, content-hashed asset that Next nonetheless serves
   * with `max-age=0, must-revalidate` — measured, not assumed. That is the same
   * defect the audit found on /icon.svg, and it means every unfurl misses
   * CloudFront and wakes the 37 MB server function instead. Unfurlers fetch
   * og:image eagerly and in parallel, so this is exactly the "origin hit on a
   * normal pageview" the comment above calls a bug rather than a nit.
   *
   * Safe to cache hard because Next appends a content hash to the URL
   * (`/opengraph-image?6c29681690ea3652`) — change the card and the query
   * changes with it, so `immutable` can never serve a stale design.
   *
   * `max-age` stays short for browsers, `s-maxage` long for the CDN: the shared
   * cache is the one doing the work here.
   */
  async headers() {
    return [
      {
        source: "/opengraph-image",
        headers: [
          {
            key: "cache-control",
            value: "public, max-age=3600, s-maxage=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
