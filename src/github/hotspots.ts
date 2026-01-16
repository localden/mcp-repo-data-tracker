/**
 * Fetch file change data for hotspot analysis
 */

import type { GitHubClient } from './client.js';
import { processBatched } from './client.js';
import type { GitHubPullRequest, GitHubPRFile, HotspotRawData } from '../types/index.js';

// Reduced batch size and added delay to avoid secondary rate limits
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000; // 1 second between batches

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

  const results = await processBatched(
    mergedPRs,
    BATCH_SIZE,
    BATCH_DELAY_MS,
    async (pr) => {
      try {
        const response = await client.rest.pulls.listFiles({
          owner,
          repo,
          pull_number: pr.number,
          per_page: 300,
        });

        const files: GitHubPRFile[] = response.data.map((file) => ({
          filename: file.filename,
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
        }));

        processed++;
        if (verbose && processed % 10 === 0) {
          console.log(`    Processed ${processed}/${mergedPRs.length} PRs...`);
        }

        return {
          prNumber: pr.number,
          files,
        };
      } catch (error) {
        console.warn(`Warning: Failed to fetch files for PR #${pr.number}:`, error);
        processed++;
        return {
          prNumber: pr.number,
          files: [],
        };
      }
    }
  );

  return results;
}
