/**
 * BreadcrumbList markup for a visible breadcrumb trail.
 *
 * This takes the SAME array the <Breadcrumbs> component renders, which is the
 * whole reason it lives here as a pure function. Marking up a hierarchy the
 * visitor cannot see is a structured-data violation, so the markup and the
 * visible trail have to be built from one source or they will drift — the
 * failure mode components/faq.tsx already guards against by colocating its
 * script with its block.
 *
 * The tier that needs this most is /business/<slug>: 14,981 flat URLs whose
 * path states no hierarchy at all, so the markup is the only way to say that
 * Atlantis is a Hotel in Palm Jumeirah. On the facet tiers Google can already
 * infer a trail from /area/al-barsha/restaurants, and the gain is modest.
 */

export interface Crumb {
  /** Absent on the current page, and on any crumb that is a label rather than a destination. */
  href?: string;
  label: string;
}

interface ListItem {
  "@type": "ListItem";
  position: number;
  name: string;
  item?: string;
}

export interface BreadcrumbList {
  "@context": "https://schema.org";
  "@type": "BreadcrumbList";
  itemListElement: ListItem[];
}

/**
 * Below two crumbs there is no hierarchy to describe. Emitting a one-item list
 * says nothing and still costs a validation surface, so the caller gets null
 * and skips the <script> entirely.
 */
const MIN_TRAIL = 2;

export function breadcrumbJsonLd(
  trail: Crumb[],
  baseUrl: string,
): BreadcrumbList | null {
  if (trail.length < MIN_TRAIL) return null;

  // The base is duplicated across sitemap.ts, robots.ts and layout.tsx, so it
  // reaches here in whatever shape the caller holds it. Normalising once is
  // cheaper than trusting every call site to agree about the trailing slash.
  const base = baseUrl.replace(/\/+$/, "");

  const itemListElement = trail.map((crumb, index): ListItem => {
    const entry: ListItem = {
      "@type": "ListItem",
      position: index + 1,
      name: crumb.label,
    };

    // Two separate reasons to carry no `item`, and both must resolve to the key
    // being absent rather than undefined:
    //
    //   - the last crumb is the page you are already on, and Google's guidance
    //     is that it carries no item. A self-link here is the single most
    //     common way this markup gets flagged.
    //   - a mid-trail crumb without an href has no URL to point at. Falling
    //     back to the base would be a lie about where that level lives.
    const isLast = index === trail.length - 1;
    if (!isLast && crumb.href) {
      entry.item = `${base}${crumb.href}`;
    }

    return entry;
  });

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement,
  };
}
