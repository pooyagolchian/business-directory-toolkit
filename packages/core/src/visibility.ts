/**
 * AI visibility — is this directory cited by answer engines, and if not, who is?
 *
 * WHY THIS EXISTS
 *
 * Milestone 3 is programmatic SEO, and every number behind it assumes a ranked
 * list of links: someone searches, ten blue links come back, one is ours. A
 * growing share of "restaurants in dubai marina" never reaches that list — it
 * is answered inline by ChatGPT, Perplexity, Google's AI Mode and AI Overviews,
 * from a handful of cited sources. On those surfaces there is no position 4.
 * You are cited or you are invisible, and rank tracking cannot tell the
 * difference because it is not looking at the surface the answer came from.
 *
 * So the repo that measures everything else it claims had no figure at all for
 * the channel most likely to decide whether the directory is ever read.
 *
 * THE SECOND HALF IS THE USEFUL HALF. For a new deployment "are we cited" is
 * almost certainly no, and that is a legitimate baseline. Every response also
 * names its sources, so tallying those across a probe set says which domains
 * own the answers to local-business questions in this city — which is
 * actionable on day one, while our own number is still zero.
 *
 * Everything here is pure and fixture-tested. The HTTP calls, the credit gate
 * and the report live in packages/pipeline/src/cli/visibility.ts, because a
 * test that spends a credit is a broken test.
 */

export type VisibilityEngine =
  "chatgpt" | "perplexity" | "google_ai_mode" | "google_ai_overview";

export interface Probe {
  query: string;
  category: string;
}

export interface ProbeResult extends Probe {
  engine: VisibilityEngine;
  cited: boolean;
  /**
   * 1-based rank in the citation list, or null.
   *
   * Null rather than 0 on purpose: a 0 sorts and averages as though it were a
   * very good rank, and this figure will end up in a report.
   */
  position: number | null;
  /** Registrable domains cited, deduplicated, in the order the engine returned them. */
  citations: string[];
}

export interface VisibilitySummary {
  probes: number;
  cited: number;
  citationRate: number;
  /**
   * Probes where the engine named no sources at all. Surfaced because it is
   * the signal that a response shape has drifted — see citationsFrom.
   */
  probesWithNoCitations: number;
  byEngine: Partial<
    Record<VisibilityEngine, { probes: number; cited: number }>
  >;
  topDomains: Array<{ domain: string; citations: number; share: number }>;
}

/** Structurally satisfied by CategoryDemand from `pnpm demand`. */
export interface DemandInput {
  category: string;
  /** Suggestion.area is set when the query names one of the city's tiles. */
  suggestions: Array<{
    query: string;
    rank: number;
    area?: string | undefined;
  }>;
  /** Neighbourhoods people attach to this category, most-searched first. */
  areasInDemand?: string[] | undefined;
}

// ------------------------------------------------------------------ citations

/**
 * Every key any of the four engines has been seen to hang its sources on.
 *
 * They genuinely differ, parts of the shape are undocumented, and they will
 * drift — SearchApi is wrapping four upstreams that each change independently.
 */
const CITATION_KEYS = [
  "reference_links",
  "references",
  "sources",
  "links",
] as const;

/** AI Overview nests its whole payload one level down. */
const ENVELOPE_KEYS = ["ai_overview", "answer", "result"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function urlsFromList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    // Two shapes in the wild: a bare URL string, or an object with the URL
    // under `link` or `url`.
    if (typeof entry === "string") {
      out.push(entry);
      continue;
    }
    if (!isRecord(entry)) continue;
    const link = entry.link ?? entry.url;
    if (typeof link === "string" && link.trim() !== "") out.push(link);
  }
  return out;
}

/**
 * Pull the cited URLs out of whatever an engine returned.
 *
 * DELIBERATELY TOTAL: it never throws and never rejects a response. A parser
 * that threw on an unexpected shape would convert a response we paid for into a
 * response we lost, and — worse — would do it at the exact moment an upstream
 * changed, i.e. when the measurement matters most. Instead it returns what it
 * can find, and the CLI reports how many probes yielded nothing, so drift
 * surfaces as a visible anomaly in the output rather than as a crash or a
 * silent zero.
 */
export function citationsFrom(response: unknown): string[] {
  if (!isRecord(response)) return [];

  const scopes: Record<string, unknown>[] = [response];
  for (const key of ENVELOPE_KEYS) {
    const nested = response[key];
    if (isRecord(nested)) scopes.push(nested);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const scope of scopes) {
    for (const key of CITATION_KEYS) {
      for (const url of urlsFromList(scope[key])) {
        if (seen.has(url)) continue;
        seen.add(url);
        out.push(url);
      }
    }
  }
  return out;
}

// --------------------------------------------------------------------- domains

/** Host only: no scheme, no `www.`, no path, lowercased. Null if unparseable. */
export function domainOf(url: string): string | null {
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/**
 * Whether a citation is this deployment.
 *
 * Exact host equality, never a substring or a suffix test. `pooyagolchian.com`
 * is a different property with a different reason to exist, and crediting the
 * directory for a citation of the personal site would inflate the single number
 * this tool exists to report honestly. A suffix test would also hand a win to
 * `notdirectory.pooyagolchian.com.evil.test`.
 */
export function isOurDomain(url: string, site: string): boolean {
  const domain = domainOf(url);
  if (!domain) return false;
  return domain === site.toLowerCase().replace(/^www\./, "");
}

// ---------------------------------------------------------------------- probes

/**
 * Choose what to ask.
 *
 * Not invented — taken from data/demand.json, which holds real Google
 * autocomplete suggestions ordered by query popularity. Those are queries
 * people actually type, which makes them the right prompts to put to an answer
 * engine, and using them keeps the probe set reproducible and moving with
 * demand rather than with somebody's taste.
 *
 * Ordering is by areasInDemand — how many neighbourhoods people attach to this
 * category — because that is a measured signal of local intent, and local
 * intent is what an area x category page competes for. Ordering by suggestion
 * volume instead collapses to alphabetical (Google returns a near-constant
 * number of suggestions per seed) and leads the probe set with "accounting in
 * dubai salary".
 *
 * The tie-break chain is total, so two runs measure the same thing. A
 * month-over-month diff means nothing otherwise.
 */
export function selectProbes(demand: DemandInput[], limit: number): Probe[] {
  return [...demand]
    .filter((d) => d.suggestions.length > 0)
    .sort(
      (a, b) =>
        (b.areasInDemand?.length ?? 0) - (a.areasInDemand?.length ?? 0) ||
        b.suggestions.length - a.suggestions.length ||
        a.category.localeCompare(b.category),
    )
    .slice(0, limit)
    .map((d) => {
      const byRank = [...d.suggestions].sort((x, y) => x.rank - y.rank);
      // A suggestion that names a neighbourhood beats a more popular one that
      // does not. "gyms in dubai marina" is the query this directory's area x
      // category pages exist to answer; "gyms in dubai price" is not a query a
      // directory can win, and measuring against it would understate nothing
      // useful. Falls back to the most popular suggestion when no local variant
      // was returned.
      const best = byRank.find((sug) => sug.area) ?? byRank[0];
      return { query: best!.query, category: d.category };
    });
}

export function scoreProbe(
  probe: Probe,
  engine: VisibilityEngine,
  urls: string[],
  site: string,
): ProbeResult {
  const citations: string[] = [];
  let position: number | null = null;

  for (const [index, url] of urls.entries()) {
    if (position === null && isOurDomain(url, site)) position = index + 1;
    const domain = domainOf(url);
    // Our own domain is not a competitor, so it stays out of the share-of-voice
    // tally — otherwise the site would compete with itself in its own report.
    if (!domain || isOurDomain(url, site)) continue;
    if (!citations.includes(domain)) citations.push(domain);
  }

  return { ...probe, engine, cited: position !== null, position, citations };
}

// --------------------------------------------------------------------- summary

/** How many domains the report names. Past this it is a long tail, not a story. */
const TOP_DOMAINS = 20;

export function summarise(results: ProbeResult[]): VisibilitySummary {
  const byEngine: VisibilitySummary["byEngine"] = {};
  const domainCounts = new Map<string, number>();
  let cited = 0;
  let probesWithNoCitations = 0;

  for (const r of results) {
    const bucket = (byEngine[r.engine] ??= { probes: 0, cited: 0 });
    bucket.probes++;
    if (r.cited) {
      bucket.cited++;
      cited++;
    }
    if (r.citations.length === 0 && !r.cited) probesWithNoCitations++;
    for (const domain of r.citations) {
      domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
    }
  }

  const totalCitations = [...domainCounts.values()].reduce((a, b) => a + b, 0);
  const topDomains = [...domainCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_DOMAINS)
    .map(([domain, count]) => ({
      domain,
      citations: count,
      share: totalCitations === 0 ? 0 : count / totalCitations,
    }));

  return {
    probes: results.length,
    cited,
    citationRate: results.length === 0 ? 0 : cited / results.length,
    probesWithNoCitations,
    byEngine,
    topDomains,
  };
}
