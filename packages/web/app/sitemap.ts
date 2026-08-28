import type { MetadataRoute } from "next";
import { SITE_URL as BASE } from "@/lib/site";
import {
  allBusinesses,
  areas,
  byAreaCategory,
  categories,
  categoriesInArea,
} from "@/lib/data";

/** Matches the index guard on the area x category pages. */
const MIN_FOR_INDEX = 3;

/**
 * Only submit what we are willing to have indexed.
 *
 * Padding a sitemap with thin pages wastes crawl budget and teaches Google that
 * the sitemap is unreliable — so the /search route and any area x category page
 * below the threshold are deliberately absent.
 *
 * Google's limit is 50,000 URLs per sitemap; at ~10k businesses this fits in
 * one file, but generateSitemaps() is the split point when it stops fitting.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${BASE}/categories`, lastModified: now, priority: 0.8 },
    { url: `${BASE}/areas`, lastModified: now, priority: 0.8 },
  ];

  const categoryPages: MetadataRoute.Sitemap = categories().map((c) => ({
    url: `${BASE}/category/${c.slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const areaPages: MetadataRoute.Sitemap = areas().map((a) => ({
    url: `${BASE}/area/${a.slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const moneyPages: MetadataRoute.Sitemap = [];
  for (const area of areas()) {
    for (const category of categoriesInArea(area.slug)) {
      if (byAreaCategory(area.slug, category.slug).length < MIN_FOR_INDEX) {
        continue;
      }
      moneyPages.push({
        url: `${BASE}/area/${area.slug}/${category.slug}`,
        lastModified: now,
        changeFrequency: "weekly",
        priority: 0.9, // the pages that match how people actually search
      });
    }
  }

  const businessPages: MetadataRoute.Sitemap = allBusinesses().map((b) => ({
    url: `${BASE}/business/${b.slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [
    ...staticPages,
    ...moneyPages,
    ...categoryPages,
    ...areaPages,
    ...businessPages,
  ];
}
