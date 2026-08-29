import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * There is deliberately no `images.remotePatterns` block here any more.
   *
   * It allow-listed lh3/lh5.googleusercontent.com for Google listing thumbnails
   * — and nothing in the app has ever used it: zero `next/image` imports and
   * zero `<img>` tags across app/, components/ and lib/. Dead config on its own
   * is only clutter, but this particular dead config reads as a standing
   * permission to hotlink Google-hosted imagery, which is adjacent to ADR 0002
   * and would need a licensing decision rather than a config line. The stored
   * thumbnails are also 80x106 px (the `=w80-h106-k-no` suffix is a Google
   * resize directive), far below the ~1200px any social or rich-result surface
   * wants, so the block could not have been used as-is regardless.
   *
   * docs/adr/0004-design-system.md gives the design-side reason the pages carry
   * no photography at all. If images are ever wanted, settle the licensing
   * position and cache to S3 first — do not re-add this and hotlink.
   */
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
      {
        // Same defect, same fix. /icon.svg was measured serving
        // `max-age=0, must-revalidate` and `x-cache: Miss from cloudfront` on
        // every request, against `Hit` for the pages beside it — so the one
        // asset on every page in the site was the one thing always waking the
        // origin. Next content-hashes this URL too, so `immutable` is safe.
        // /apple-icon was measured serving `no-cache, no-store` — worse than the
        // default the other two had, and the same class of defect. It is
        // content-hashed too (`/apple-icon?de8eab51da91dc1e`), so it caches on
        // the same terms.
        source: "/apple-icon",
        headers: [
          {
            key: "cache-control",
            value: "public, max-age=3600, s-maxage=31536000, immutable",
          },
        ],
      },
      {
        source: "/icon.svg",
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
