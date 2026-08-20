import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { resources } from "../resources.js";
import { shouldFetchNextPage, type SearchParams } from "../fetch.js";
import type { CrawlJob } from "../plan.js";
import { createSearchApiClient } from "../searchapi.js";

const s3 = new S3Client({});
const sqs = new SQSClient({});

interface CrawlMessage extends CrawlJob {
  runId: string;
  /** place_ids already seen for this (tile, category) pair, for the yield check. */
  seen?: string[];
}

interface SqsEvent {
  Records: Array<{ body: string; messageId: string }>;
}

/**
 * SQS consumer for one (tile, category, page) job.
 *
 * Depth is decided here rather than in the plan: a page is only followed when
 * it came back full AND still yielding new businesses. The next page is
 * enqueued as a fresh message so each request is independently retryable and
 * a single failure cannot strand a whole tile.
 */
export async function handler(event: SqsEvent): Promise<void> {
  const client = createSearchApiClient(resources.SearchApiKey.value);

  for (const record of event.Records) {
    const job = JSON.parse(record.body) as CrawlMessage;
    const params: SearchParams = {
      q: job.q,
      lat: job.lat,
      lng: job.lng,
      zoom: job.zoom,
      page: job.page,
      tileId: job.tileId,
    };

    // A throw here returns the message to the queue; after `retry` attempts SST
    // routes it to the DLQ. Failing loudly beats a silently incomplete dataset.
    const response = await client(params);

    // Archive before parsing, so every later stage can be re-run for free.
    const key = `raw/${job.runId}/${job.tileId}/${job.q.replace(/\W+/g, "-")}-p${job.page}.json`;
    await s3.send(
      new PutObjectCommand({
        Bucket: resources.RawArchive.name,
        Key: key,
        Body: JSON.stringify(response),
        ContentType: "application/json",
      }),
    );

    const results = response.local_results ?? [];
    const seen = new Set(job.seen ?? []);
    let newUnique = 0;
    for (const result of results) {
      if (result.place_id && !seen.has(result.place_id)) {
        seen.add(result.place_id);
        newUnique++;
      }
    }

    const keepGoing = shouldFetchNextPage({
      page: job.page,
      maxPages: job.maxPages,
      resultCount: results.length,
      newUnique,
    });

    if (keepGoing) {
      const next: CrawlMessage = {
        ...job,
        page: job.page + 1,
        seen: [...seen],
      };
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: resources.CrawlQueue.url,
          MessageBody: JSON.stringify(next),
        }),
      );
    }

    console.log(
      JSON.stringify({
        tile: job.tileId,
        q: job.q,
        page: job.page,
        results: results.length,
        newUnique,
        enqueuedNext: keepGoing,
      }),
    );
  }
}
