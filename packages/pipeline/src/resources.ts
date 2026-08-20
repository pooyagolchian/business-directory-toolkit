import { Resource } from "sst";

/**
 * Typed access to the resources declared in `sst.config.ts`.
 *
 * SST generates `sst-env.d.ts` — which types `Resource` precisely — only after
 * a `sst dev` or `sst deploy`. That file is git-ignored and CI never deploys,
 * so without this shim CI could not typecheck the handlers at all, and real
 * errors in them would ship unchecked.
 *
 * So the cast is confined to exactly one place, right at the boundary, and
 * everything downstream is fully typed. Keep these names in step with
 * `sst.config.ts`; a mismatch surfaces at deploy time as an undefined resource.
 */
const linked = Resource as unknown as {
  SearchApiKey: { value: string };
  AnthropicApiKey: { value: string };
  RawArchive: { name: string };
  CrawlQueue: { url: string };
  Directory: { name: string };
};

export const resources = linked;
