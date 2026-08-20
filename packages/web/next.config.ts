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
};

export default nextConfig;
