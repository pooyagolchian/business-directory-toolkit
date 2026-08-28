/**
 * Organization and WebSite markup — who publishes this site, and from what.
 *
 * Every page tier already carries markup about its subject: a LocalBusiness, a
 * BreadcrumbList, an FAQPage. None of it says anything about the publisher, so
 * a machine reading the site could describe every business in detail and still
 * not name the party standing behind the description, or where the code that
 * produced it lives.
 *
 * That gap is worse here than it would be for most sites. A directory's only
 * real claim is provenance — these records came from a named source, on a known
 * date, through a pipeline anyone can read. An answer engine deciding whether
 * to cite a page is deciding whether to trust its publisher, and until now that
 * argument existed only in prose a crawler has no reason to believe.
 *
 * The two nodes go in one `@graph` rather than two sibling scripts because they
 * are one statement: this WebSite is published by this Organization. Splitting
 * them into separate documents leaves the `publisher` reference pointing at an
 * `@id` that nothing in the same document defines.
 *
 * Nothing below names a city, a domain, a person or a repository. ADR 0005: a
 * city is data, and the deployment's identity is data for exactly the same
 * reason — a fork sets its own values and must not inherit ours in markup it
 * never thought to look at. The test file asserts that by reading this source.
 */

/** The seven strings that make a deployment itself. Only two are required. */
export interface PublisherInput {
  /**
   * The deployment's own origin. Trailing slashes, surrounding whitespace, a
   * query string and a fragment are all tolerated and normalised away; a
   * relative or non-http(s) value is rejected rather than published.
   */
  siteUrl: string;
  siteName: string;
  description?: string;
  /** Where the code that built the site lives, if it is public. */
  repoUrl?: string;
  authorName?: string;
  authorUrl?: string;
  /** BCP 47. Defaults to "en". */
  inLanguage?: string;
}

export interface PersonNode {
  "@type": "Person";
  name: string;
  url?: string;
}

export interface OrganizationNode {
  "@type": "Organization";
  "@id": string;
  name: string;
  url: string;
  sameAs?: string[];
  founder?: PersonNode;
}

export interface WebSiteNode {
  "@type": "WebSite";
  "@id": string;
  name: string;
  url: string;
  description?: string;
  inLanguage: string;
  publisher: { "@id": string };
}

export interface PublisherGraph {
  "@context": "https://schema.org";
  "@graph": [OrganizationNode, WebSiteNode];
}

/**
 * A configuration value that is set but blank is not a value.
 *
 * Every optional field here arrives from a `.env` line or a CI variable, and
 * the failure those actually produce is not an absent variable — it is a
 * present one with nothing useful after the `=`, or with a space the author
 * could not see. Testing for `""` alone catches the first and misses the
 * second, which is how `sameAs: ["   "]` gets published as a fact.
 *
 * Whitespace is also trimmed off values that survive, because no JSON-LD string
 * means anything different for having a space at either end, and a URL means
 * something invalid.
 */
function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The same, for the optional fields that have to be URLs.
 *
 * A relative `sameAs` does not fail loudly — it resolves against whatever page
 * a consumer found it on, so a `repoUrl` typed without its scheme becomes a
 * claim that the publisher is also findable at a path on *this* site, which is
 * a 404. Dropping the scheme is the likeliest way to mistype a repository URL,
 * so this is the mistake most worth catching.
 *
 * These are dropped rather than thrown on, which is the opposite of `siteUrl`'s
 * treatment and for the opposite reason: nothing structural depends on them, so
 * the safe failure is the missing claim rather than the broken build.
 *
 * The caller's own spelling is returned, not the parsed round-trip. `new URL`
 * is used to decide whether the value is usable, not to rewrite it — a repo
 * path is case-sensitive and normalising it could point the link somewhere else.
 */
function optionalUrl(value: string | undefined): string | undefined {
  const trimmed = optionalText(value);
  if (trimmed === undefined) return undefined;
  try {
    const { protocol } = new URL(trimmed);
    if (protocol !== "http:" && protocol !== "https:") return undefined;
  } catch {
    return undefined;
  }
  return trimmed;
}

/**
 * The same rule for the two fields the graph cannot be built without.
 *
 * There is no degraded output worth emitting for these. A blank name gives both
 * nodes an empty `name`, which describes nobody; a blank base collapses every
 * `@id` to the relative `/#organization`, so each route emits an identifier
 * that means something different and the graph silently stops joining up with
 * itself. `city.ts` throws on a blank required config string for this reason
 * and this follows that register — a misconfigured fork should find out while
 * it is building, not after a crawler has indexed the result.
 */
function requiredText(value: string, field: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed === "") {
    throw new Error(
      `publisherJsonLd: ${field} must be a non-empty string; got ${JSON.stringify(value)}.`,
    );
  }
  return trimmed;
}

/**
 * Normalise the caller's base into the one string every `@id` is built from.
 *
 * Callers hold the base in whatever shape their configuration gave them, and
 * the cost of disagreement is high: `…//#website` is a different `@id` from
 * `…/#website`, so a single doubled slash detaches this page's graph from every
 * other page's. Parsing rather than string-trimming settles four of these at
 * once, and the corpus argues for the last two: of 10,348 crawled records
 * carrying a website, 8,346 ended in a slash and 17 already held a fragment,
 * which naive concatenation turns into a double-fragment `@id` like
 * `…/#home/#organization`.
 *
 * A query string and a fragment are dropped because neither can be part of a
 * site's identity — they select a view of a page, not a publisher. The host is
 * lower-cased because a host is case-insensitive, so two spellings of one
 * domain are one site, and would otherwise be two `@id`s that never join.
 *
 * Rejecting a relative base is the point of the exercise: schema.org resolves
 * `@id`s across documents, and a relative identifier means a different thing on
 * every route that emits it.
 */
function baseUrlOf(siteUrl: string): string {
  const raw = requiredText(siteUrl, "siteUrl");

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `publisherJsonLd: siteUrl must be an absolute URL; got ${JSON.stringify(siteUrl)}.`,
    );
  }

  // `new URL` accepts `mailto:` and every other scheme quite happily. A WebSite
  // has to be fetchable for any of this markup to be checkable.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `publisherJsonLd: siteUrl must use http or https; got ${JSON.stringify(siteUrl)}.`,
    );
  }

  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
}

export function publisherJsonLd(input: PublisherInput): PublisherGraph {
  const base = baseUrlOf(input.siteUrl);
  const name = requiredText(input.siteName, "siteName");

  // Fragment @ids, not paths. They resolve against the home page, stay stable
  // whatever route emits them, and — because they are fragments — can never
  // collide with a real URL the site serves.
  const organizationId = `${base}/#organization`;

  const organization: OrganizationNode = {
    "@type": "Organization",
    "@id": organizationId,
    name,
    url: base,
  };

  // `sameAs` is how an entity resolver joins this node to the same publisher
  // described elsewhere, and for an open-source deployment the source
  // repository is the strongest such link available: it carries the licence,
  // the commit history and the maintainer, all independently verifiable.
  const repoUrl = optionalUrl(input.repoUrl);
  if (repoUrl) {
    organization.sameAs = [repoUrl];
  }

  // The caller calls this person the author, and schema.org has no `author` on
  // an Organization. `founder` is the closer fit anyway: the human is not the
  // author of a document here, they are the party the publisher resolves to —
  // which is the claim a reader is really evaluating when they ask who compiled
  // a directory.
  //
  // A Person whose only property is a URL identifies nobody, so the name is
  // what gates the node rather than merely filling one of its fields. A Person
  // named `" "` is worse still: it is a fabricated entity, and an entity
  // resolver reconciling on `name` cannot tell it from a real one.
  const authorName = optionalText(input.authorName);
  if (authorName) {
    const founder: PersonNode = { "@type": "Person", name: authorName };
    const authorUrl = optionalUrl(input.authorUrl);
    if (authorUrl) founder.url = authorUrl;
    organization.founder = founder;
  }

  const website: WebSiteNode = {
    "@type": "WebSite",
    "@id": `${base}/#website`,
    name,
    url: base,
    // English unless told otherwise, because that is what the pages are written
    // in even where the business names inside them are not. `??` would have
    // been wrong here: it passes a blank value straight through, and
    // `inLanguage: ""` is not a BCP 47 tag but a claim that the document is
    // written in no language at all.
    inLanguage: optionalText(input.inLanguage) ?? "en",
    publisher: { "@id": organizationId },
  };

  // The description belongs to the site, not to the publisher: it says what
  // gets published, and repeating it on the Organization would claim that the
  // publisher and the publication are one thing. Two nodes are only worth
  // having if they say different things.
  const description = optionalText(input.description);
  if (description) {
    website.description = description;
  }

  // No `potentialAction` / SearchAction, deliberately.
  //
  // It is the first thing most WebSite snippets add, and it is now dead weight
  // twice over. Google retired the sitelinks searchbox result in late 2024, so
  // the markup can no longer produce the feature it exists for. Worse, this
  // site's /search route is Disallow-ed in robots.ts — it generates unbounded
  // query-string permutations with nothing unique to index — so a SearchAction
  // would hand crawlers a URL template for the one route we have explicitly
  // asked them not to crawl. Contradicting your own robots file in structured
  // data is not a neutral omission to fix; it is a defect to avoid.
  //
  // Every optional key above is omitted rather than set to undefined for a
  // related reason: `JSON.stringify` hides the difference, but anything that
  // walks the object before serialisation does not.
  return {
    "@context": "https://schema.org",
    "@graph": [organization, website],
  };
}
