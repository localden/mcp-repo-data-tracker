/**
 * Fetch commit data from GitHub
 */

import type { createGitHubClient } from './client.js';
import { FETCH_COMMITS_QUERY } from './queries.js';

export interface CommitData {
  committedDate: string;
  author: {
    user: { login: string } | null;
  } | null;
}

export interface CommitsResult {
  commits: CommitData[];
  totalCount: number;
}

/**
 * Fetch commits from the last N weeks
 */
export async function fetchCommits(
  client: ReturnType<typeof createGitHubClient>,
  owner: string,
  repo: string,
  weeks: number = 12,
  verbose: boolean = false
): Promise<CommitsResult> {
  const since = new Date();
  since.setDate(since.getDate() - weeks * 7);
  const sinceISO = since.toISOString();

  const commits: CommitData[] = [];
  let hasNextPage = true;
  let after: string | null = null;
  let totalCount = 0;

  interface CommitHistoryResponse {
    repository: {
      defaultBranchRef: {
        target: {
          history: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            totalCount: number;
            nodes: CommitData[];
          };
        };
      } | null;
    };
  }

  while (hasNextPage) {
    const response: CommitHistoryResponse = await client.graphql(FETCH_COMMITS_QUERY, {
      owner,
      repo,
      since: sinceISO,
      after,
    });

    const history = response.repository.defaultBranchRef?.target?.history as {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      totalCount: number;
      nodes: CommitData[];
    } | undefined;
    if (!history) {
      break;
    }

    commits.push(...history.nodes);
    totalCount = history.totalCount;
    hasNextPage = history.pageInfo.hasNextPage;
    after = history.pageInfo.endCursor;

    if (verbose) {
      console.log(`    Fetched ${commits.length}/${totalCount} commits...`);
    }

    // Limit to first 500 commits to avoid excessive API calls
    if (commits.length >= 500) {
      break;
    }
  }

  return { commits, totalCount };
}

/**
 * Group commits by week for trend analysis
 */
export function groupCommitsByWeek(commits: CommitData[], weeks: number = 12): number[] {
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  // Initialize array with zeros for each week
  const weekCounts = new Array(weeks).fill(0);

  for (const commit of commits) {
    const commitTime = new Date(commit.committedDate).getTime();
    const weeksAgo = Math.floor((now - commitTime) / weekMs);

    if (weeksAgo >= 0 && weeksAgo < weeks) {
      // Index 0 = oldest week, index weeks-1 = most recent
      weekCounts[weeks - 1 - weeksAgo]++;
    }
  }

  return weekCounts;
}
