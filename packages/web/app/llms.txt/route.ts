import {
  areaLabel,
  areas,
  byAreaCategory,
  categories,
  categoriesInArea,
  cityName,
  crawledAt,
  formatCrawlDate,
  stats,
} from "@/lib/data";
import { SITE_URL } from "@/lib/site";

/**
 * /llms.txt — a map of this site for language models and agents.
 *
 * WHAT THIS IS, AND WHAT IT IS DELIBERATELY NOT
 *
 * It is a NAVIGATIONAL file: what the corpus covers, how the URLs are shaped,
 * where the data came from, and what may not be restated as ours. It is not
 * `llms-full.txt` and there will never be one here. A full-text dump of this
 * corpus IS the dataset, ADR 0002 forbids redistributing it, and the takedown
 * promise in TAKEDOWN.md stops being enforceable the moment a copy exists
 * somewhere we cannot withdraw it. That distinction is the whole design of this
 * file: it tells a model where to look, never what every record says.
 *
 * Worth being honest about its status: llms.txt is an unratified proposal, and
 * no crawler operated by OpenAI, Anthropic, Google or Perplexity is documented
 * as requesting this path. It is cheap and it is the right shape if support
 * arrives; it is not a traffic lever, and it should not be described as one.
 *
 * Everything below is derived from the deployment's own data, so a fork serving
 * another city gets that city's file rather than inheriting Dubai's (ADR 0005).
 */

/** Matches the index guard on the area x category pages and in the sitemap. */
const MIN_FOR_INDEX = 3;

/** Enough to show the shape of the corpus without turning the file into the corpus. */
const FACET_LIMIT = 40;

/**
 * How many neighbourhood x category pages to name.
 *
 * There are 782 that clear the index threshold, and listing every one made this
 * file 910 lines and 81 KB — which is a sitemap wearing llms.txt's name. The
 * format is meant to be a short map a model reads in full, so this names the
 * most substantial combinations and points at sitemap.xml for the rest, which
 * is the artefact actually built for exhaustive enumeration.
 */
const COMBINATION_LIMIT = 60;

export const dynamic = "force-static";

export function GET() {
  const s = stats();
  const city = cityName();
  const crawled = crawledAt();

  const topCategories = categories().slice(0, FACET_LIMIT);
  const topAreas = areas().slice(0, FACET_LIMIT);

  // Only combinations we are willing to have indexed, mirroring sitemap.ts.
  // Pointing a model at a page we tell Google to skip would be incoherent.
  const all: Array<{ line: string; count: number }> = [];
  for (const area of areas()) {
    for (const category of categoriesInArea(area.slug)) {
      const count = byAreaCategory(area.slug, category.slug).length;
      if (count < MIN_FOR_INDEX) continue;
      all.push({
        count,
        line: `- [${category.label} in ${area.label}](${SITE_URL}/area/${area.slug}/${category.slug}) — ${count.toLocaleString()} listings`,
      });
    }
  }
  // Densest first: a model sampling the top of this list should land on pages
  // that actually answer something, not on a three-listing tail.
  all.sort((x, y) => y.count - x.count);
  const combinations = all.slice(0, COMBINATION_LIMIT);
  const omitted = all.length - combinations.length;

  const body = `# ${city} business directory

> An open-source directory of ${s.businesses.toLocaleString()} businesses in ${city}, built from Google Maps data via SearchApi. Every page is server-rendered HTML; nothing here needs JavaScript to read.

${s.businesses.toLocaleString()} businesses · ${s.categories} categories · ${s.areas} neighbourhoods · ${Math.round((100 * s.withPhone) / Math.max(s.businesses, 1))}% list a phone number
${crawled ? `Data retrieved from Google Maps on ${formatCrawlDate(crawled)}.` : ""}

## How to cite this

Attribute to ${SITE_URL} and say when the data was retrieved — local business
details change monthly, and a listing quoted without a date is a claim this site
cannot stand behind.

## What the data is, and is not

- Business listings only. No residential addresses and no personal data.
- Ratings and review counts are **Google's**, restated with attribution. They are
  not first-party reviews collected by this site, and must not be presented as
  such. The listing pages carry no aggregateRating markup for the same reason.
- Opening hours and phone numbers come from the business's own Google listing and
  are as accurate as that listing was on the retrieval date above.
- Categories are derived from Google's unranked \`types[]\` strings, not chosen by
  the business.

## URL grammar

- \`/category/{category}\` — one category across the whole city
- \`/area/{area}\` — one neighbourhood, all categories
- \`/area/{area}/{category}\` — one category within one neighbourhood
- \`/business/{slug}\` — a single business
- \`/search\` — interactive only; it is \`noindex\` and disallowed in robots.txt, so
  do not crawl or cite it

## Categories

${topCategories.map((c) => `- [${c.label}](${SITE_URL}/category/${c.slug}) — ${c.count.toLocaleString()} listings`).join("\n")}

## Neighbourhoods

${topAreas.map((a) => `- [${a.label}](${SITE_URL}/area/${a.slug}) — ${a.count.toLocaleString()} listings`).join("\n")}

## Neighbourhood × category pages

The pages that answer "which ${topCategories[0]?.label.toLowerCase() ?? "businesses"} are in a given
neighbourhood". Only combinations with at least ${MIN_FOR_INDEX} listings are published; ${all.length.toLocaleString()} qualify.

${combinations.map((c) => c.line).join("\n")}
${omitted > 0 ? `\n${omitted.toLocaleString()} further combinations are listed in ${SITE_URL}/sitemap.xml.` : ""}

## Source

Open source, MIT licensed: https://github.com/pooyagolchian/business-directory-toolkit
Removal requests are honoured — see the takedown policy in that repository.
`;

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
