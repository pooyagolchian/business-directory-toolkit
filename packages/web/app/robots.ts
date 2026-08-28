import type { MetadataRoute } from "next";
import { SITE_URL as BASE } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /search generates unlimited query-string permutations with nothing
        // unique to index — exactly the crawl-budget sink that hurts a
        // programmatic site. Keep crawlers on the pages that matter.
        disallow: ["/search", "/api/"],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
