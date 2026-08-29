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
/**
 * Read an override, treating a set-but-empty value as unset.
 *
 * `process.env.X ?? default` is wrong here, and dangerously so: `??` only
 * catches null and undefined, so `DIRECTORY_SITE_URL=` in a .env file yields ""
 * — which then reaches `new URL("")` in the root layout's metadataBase and
 * throws, taking down EVERY route. An empty assignment is the most natural way
 * to write "leave this at the default", and .env.example now invites exactly
 * that, so it has to mean what a reader expects it to mean.
 */
function override(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export const SITE_URL = override(
  process.env.DIRECTORY_SITE_URL,
  "https://directory.pooyagolchian.com",
).replace(/\/+$/, "");

/**
 * The registrable host, for anything that wants the name rather than the URL —
 * the OG card's footer, and the AI-visibility probe's "is this us?" check.
 */
export const SITE_HOST = new URL(SITE_URL).host;

/**
 * The rest of the deployment's identity, for the Organization/WebSite graph.
 *
 * Environment-driven for the same reason SITE_URL is. A fork's directory is
 * published by whoever forked it, and shipping this deployment's name, repo and
 * author inside their structured data would attribute their site to someone
 * else — a worse failure than having no publisher markup at all, which is what
 * the site had before. Defaults keep the reference deployment working with no
 * configuration (ADR 0005).
 */
export const SITE_NAME = override(
  process.env.DIRECTORY_SITE_NAME,
  "Directory from Scratch",
);

export const REPO_URL = override(
  process.env.DIRECTORY_REPO_URL,
  "https://github.com/pooyagolchian/business-directory-toolkit",
);

export const AUTHOR_NAME = override(
  process.env.DIRECTORY_AUTHOR_NAME,
  "Pooya Golchian",
);

export const AUTHOR_URL = override(
  process.env.DIRECTORY_AUTHOR_URL,
  "https://pooyagolchian.com",
);
