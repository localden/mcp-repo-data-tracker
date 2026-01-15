/**
 * Fetch file change data for hotspot analysis
 */

import type { GitHubClient } from './client.js';
import type { GitHubPullRequest, GitHubPRFile, HotspotRawData } from '../types/index.js';

const BATCH_SIZE = 20;

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
  const results: HotspotRawData[] = [];

  // Process PRs in batches
  for (let i = 0; i < mergedPRs.length; i += BATCH_SIZE) {
    const batch = mergedPRs.slice(i, i + BATCH_SIZE);

    // Fetch files for each PR in parallel
    const batchResults = await Promise.all(
      batch.map(async (pr) => {
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

          return {
            prNumber: pr.number,
            files,
          };
        } catch (error) {
          console.warn(`Warning: Failed to fetch files for PR #${pr.number}:`, error);
          return {
            prNumber: pr.number,
            files: [],
          };
        }
      })
    );

    results.push(...batchResults);

    if (verbose) {
      console.log(`    Processed ${Math.min(i + BATCH_SIZE, mergedPRs.length)}/${mergedPRs.length} PRs...`);
    }
  }

  return results;
}
