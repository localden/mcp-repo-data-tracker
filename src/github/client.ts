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
