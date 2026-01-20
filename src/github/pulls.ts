/**
 * Fetch pull requests from GitHub repository
 */

import type { GitHubClient } from './client.js';
import { sleep, withRetry } from './client.js';
import type { GitHubPullRequest, PullRequestData } from '../types/index.js';
import { FETCH_PRS_QUERY } from './queries.js';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
// Delay between paginated requests to avoid secondary rate limits
const PAGE_DELAY_MS = 300;

interface PRsQueryResponse {
  repository: {
    pullRequests: {
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
      nodes: GitHubPullRequest[];
    };
  };
}

/**
 * Fetch all pull requests from a repository
 */
export async function fetchPullRequests(
  client: GitHubClient,
  owner: string,
  repo: string,
  verbose: boolean
): Promise<PullRequestData> {
  const openPRs = await fetchPRsByState(client, owner, repo, ['OPEN'], verbose);
  const closedPRs = await fetchPRsByState(client, owner, repo, ['CLOSED', 'MERGED'], verbose, true);

  return {
    open: openPRs,
    closed: closedPRs,
  };
}

/**
 * Fetch PRs by state with pagination
 */
async function fetchPRsByState(
  client: GitHubClient,
  owner: string,
  repo: string,
  states: string[],
  verbose: boolean,
  stopAtCutoff = false
): Promise<GitHubPullRequest[]> {
  const prs: GitHubPullRequest[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  const cutoffDate = new Date(Date.now() - NINETY_DAYS_MS);

  while (hasNextPage) {
    const response: PRsQueryResponse = await withRetry(() =>
      client.graphql(FETCH_PRS_QUERY, {
        owner,
        repo,
        after: cursor,
        states,
      })
    );

    if (!response?.repository?.pullRequests) {
      throw new Error(`GraphQL query failed for PRs: ${JSON.stringify(response)}`);
    }

    const pageInfo = response.repository.pullRequests.pageInfo;
    const nodes = response.repository.pullRequests.nodes;

    for (const pr of nodes) {
      // For closed PRs, stop when we reach PRs updated before the cutoff
      if (stopAtCutoff && new Date(pr.updatedAt) < cutoffDate) {
        hasNextPage = false;
        break;
      }

      prs.push(pr);
    }

    if (hasNextPage) {
      hasNextPage = pageInfo.hasNextPage;
      cursor = pageInfo.endCursor;
      // Add delay between pages to avoid secondary rate limits
      if (hasNextPage) {
        await sleep(PAGE_DELAY_MS);
      }
    }

    if (verbose) {
      console.log(`    Fetched ${prs.length} ${states.join('/')} PRs...`);
    }
  }

  return prs;
}
