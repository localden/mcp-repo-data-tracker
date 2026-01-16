/**
 * GitHub API client wrapper
 */

import { graphql } from '@octokit/graphql';
import { Octokit } from '@octokit/rest';

export interface GitHubClient {
  graphql: typeof graphql;
  rest: Octokit;
}

export function createGitHubClient(): GitHubClient {
  const token = process.env.GITHUB_TOKEN || process.env.GH_PAT;

  if (!token) {
    throw new Error('GITHUB_TOKEN or GH_PAT environment variable is required');
  }

  const graphqlClient = graphql.defaults({
    headers: {
      authorization: `token ${token}`,
    },
  });

  const restClient = new Octokit({
    auth: token,
  });

  return {
    graphql: graphqlClient,
    rest: restClient,
  };
}

/**
 * Log rate limit information after API calls
 */
export function logRateLimit(response: { headers?: Record<string, string> }, verbose: boolean) {
  if (!verbose || !response.headers) return;

  const remaining = response.headers['x-ratelimit-remaining'];
  const limit = response.headers['x-ratelimit-limit'];
  const reset = response.headers['x-ratelimit-reset'];

  if (remaining && limit) {
    const resetDate = reset ? new Date(parseInt(reset) * 1000).toLocaleTimeString() : 'unknown';
    console.log(`  Rate limit: ${remaining}/${limit} remaining (resets at ${resetDate})`);
  }
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Process items in batches with rate limiting
 * @param items - Array of items to process
 * @param batchSize - Number of items to process in parallel
 * @param delayMs - Delay in milliseconds between batches
 * @param processor - Async function to process each item
 */
export async function processBatched<T, R>(
  items: T[],
  batchSize: number,
  delayMs: number,
  processor: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    // Process batch in parallel
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);

    // Add delay between batches (but not after the last batch)
    if (i + batchSize < items.length) {
      await sleep(delayMs);
    }
  }

  return results;
}
