/**
 * Fetch file change data for hotspot analysis
 */

import type { GitHubClient } from './client.js';
import { processSequential } from './client.js';
import type { GitHubPullRequest, GitHubPRFile, HotspotRawData } from '../types/index.js';

// Delay between sequential requests to avoid secondary rate limits
const REQUEST_DELAY_MS = 200; // 200ms between each request (~5 requests/second)

/**
 * Fetch files for merged PRs to analyze hotspots
 */
export async function fetchHotspotData(
  client: GitHubClient,
  owner: string,
  repo: string,
  mergedPRs: GitHubPullRequest[],
  verbose: boolean
): Promise<HotspotRawData[]> {
  let processed = 0;

  const results = await processSequential(
    mergedPRs,
    REQUEST_DELAY_MS,
    async (pr) => {
      let files: GitHubPRFile[];
      try {
        const data = await client.rest.paginate(client.rest.pulls.listFiles, {
          owner,
          repo,
          pull_number: pr.number,
          per_page: 100,
        });
        files = data.map((file) => ({
          filename: file.filename,
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
        }));
      } catch (err) {
        // GitHub returns 422 diff:not_available for PRs whose diff it can't
        // compute (huge PRs, GC'd base, etc). Skip those rather than failing
        // the whole repo's hotspot analysis.
        const e = err as Error & { status?: number };
        if (e.status && e.status >= 400 && e.status < 500 && e.status !== 403 && e.status !== 429) {
          console.warn(`    Skipping PR #${pr.number}: ${e.message.split('\n')[0]}`);
          files = [];
        } else {
          throw err;
        }
      }

      processed++;
      if (verbose && processed % 20 === 0) {
        console.log(`    Processed ${processed}/${mergedPRs.length} PRs...`);
      }

      return {
        prNumber: pr.number,
        files,
      };
    }
  );

  return results;
}
