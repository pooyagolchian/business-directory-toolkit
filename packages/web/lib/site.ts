/**
 * The deployment's own origin.
 *
 * This was hard-coded in three places — app/sitemap.ts, app/robots.ts and the
 * metadataBase in app/layout.tsx — and the BreadcrumbList markup needs a fourth
 * copy, because schema.org wants absolute URLs. Four literals of the same
 * string is three chances for a fork to ship this deployment's domain inside
 * its own structured data.
 *
 * Environment-driven for the same reason DIRECTORY_CITY is (ADR 0005): a city
 * is data, and so is the host it is served from. The default keeps the
 * reference deployment working with no configuration.
 *
 * No trailing slash, so `${SITE_URL}${path}` is always correct for a path that
 * begins with one.
 */
export const SITE_URL = (
  process.env.DIRECTORY_SITE_URL ?? "https://directory.pooyagolchian.com"
).replace(/\/+$/, "");

/**
 * The registrable host, for anything that wants the name rather than the URL —
 * the OG card's footer, and the AI-visibility probe's "is this us?" check.
 */
export const SITE_HOST = new URL(SITE_URL).host;
