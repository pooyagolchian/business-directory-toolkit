/// <reference path="./.sst/platform/config.d.ts" />

/**
 * Infrastructure for Business Directory Toolkit.
 *
 * Region is us-east-1 — see docs/adr/0003-deploy-region.md. Serving Dubai from
 * Virginia is ~250ms, so CloudFront doing the caching is load-bearing here, not
 * a nicety.
 */
export default $config({
  app(input) {
    return {
      name: "directory-from-scratch",
      // Production keeps its data if the stack is torn down; dev does not.
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: input?.stage === "production",
      home: "aws",
      providers: {
        aws: { region: "us-east-1" },
      },
    };
  },

  async run() {
    // Lambda's Node 24 runtime. nodejs20.x reached end of support on
    // 30 Apr 2026 and must not be used. If SST's type union has not caught up
    // with nodejs24.x, nodejs22.x is supported until Apr 2027.
    $transform(sst.aws.Function, (args) => {
      args.runtime ??= "nodejs24.x";
      args.architecture ??= "arm64"; // cheaper per GB-second than x86
      args.nodejs ??= { install: ["libphonenumber-js"] };
    });

    // Credentials live in SSM Parameter Store, never in the repo or in CI logs.
    //   npx sst secret set SearchApiKey    "..."
    //   npx sst secret set AnthropicApiKey "..."
    const searchApiKey = new sst.Secret("SearchApiKey");
    const anthropicApiKey = new sst.Secret("AnthropicApiKey");

    /**
     * Every raw engine response, archived before it is parsed. This is the
     * single biggest cost lever in the project: normalisation, taxonomy and
     * loading can all be re-run from here without re-spending API credits.
     */
    const rawArchive = new sst.aws.Bucket("RawArchive");

    /**
     * Single-table design.
     *
     *   Business    PK BIZ#{placeId}   SK A#META
     *   Typeahead   PK PFX#{prefix}    SK {invReviews}#{placeId}
     *
     * Both global indexes are sparse on purpose: a listing with no phone never
     * enters PhoneIndex, and an unmapped business never enters BrowseIndex,
     * because it has no page to appear on.
     */
    const table = new sst.aws.Dynamo("Directory", {
      fields: {
        PK: "string",
        SK: "string",
        GSI1PK: "string", // PH#{e164}          — reverse phone lookup
        GSI1SK: "string",
        GSI2PK: "string", // CAT#{l2}#AREA#{area} — SEO browse pages
        GSI2SK: "string", // inverted review count, so popular sorts first
      },
      primaryIndex: { hashKey: "PK", rangeKey: "SK" },
      globalIndexes: {
        PhoneIndex: { hashKey: "GSI1PK", rangeKey: "GSI1SK" },
        BrowseIndex: { hashKey: "GSI2PK", rangeKey: "GSI2SK" },
      },
    });

    /**
     * Crawl jobs, one message per (tile, category, page).
     *
     * Concurrency is capped to stay inside SearchApi's rate limit — an
     * unbounded fan-out would burn credits into 429s. Failures land in the DLQ
     * rather than disappearing: a silently incomplete dataset is the worst
     * outcome, because nothing looks wrong.
     */
    const crawlDlq = new sst.aws.Queue("CrawlDlq");
    const crawlQueue = new sst.aws.Queue("CrawlQueue", {
      dlq: { queue: crawlDlq.arn, retry: 3 },
      visibilityTimeout: "5 minutes",
    });

    crawlQueue.subscribe(
      {
        handler: "packages/pipeline/src/handlers/fetch.handler",
        link: [searchApiKey, rawArchive, crawlQueue],
        timeout: "2 minutes",
        environment: { RAW_BUCKET: rawArchive.name },
      },
      {
        batch: { size: 1 },
        transform: {
          eventSourceMapping: { scalingConfig: { maximumConcurrency: 5 } },
        },
      },
    );

    /** Stage 3 — distinct categories to taxonomy, via the Claude Batch API. */
    const classifier = new sst.aws.Function("Classifier", {
      handler: "packages/pipeline/src/handlers/classify.handler",
      link: [anthropicApiKey, rawArchive, table],
      timeout: "15 minutes",
      memory: "1 GB",
      environment: { RAW_BUCKET: rawArchive.name },
    });

    /**
     * The site. Server Components read DynamoDB directly — there is no API
     * service in between, because a second cold start would land straight in
     * the latency numbers Milestone 2 publishes.
     */
    const web = new sst.aws.Nextjs("Web", {
      path: "packages/web",
      domain: {
        name:
          $app.stage === "production"
            ? "directory.pooyagolchian.com"
            : `${$app.stage}.directory.pooyagolchian.com`,
        // pooyagolchian.com is already a Route 53 zone in this account, so the
        // record and its ACM certificate are provisioned with no manual step.
        dns: sst.aws.dns(),
      },
      link: [table],
    });

    return {
      site: web.url,
      table: table.name,
      rawArchive: rawArchive.name,
      crawlQueue: crawlQueue.url,
      classifier: classifier.name,
    };
  },
});
