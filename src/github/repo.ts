/**
 * Fetch repository statistics
 */

import type { GitHubClient } from './client.js';
import type { RepositoryStats } from '../types/index.js';

/**
 * Fetch basic repository statistics
 */
export async function fetchRepoStats(
  client: GitHubClient,
  owner: string,
  repo: string
): Promise<RepositoryStats> {
  const response = await client.rest.repos.get({
    owner,
    repo,
  });

  return {
    stars: response.data.stargazers_count,
    forks: response.data.forks_count,
  };
}
