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
 * Check if an error is retriable (rate limit, timeout, or transient server error)
 */
function isRetriableError(error: Error): { retriable: boolean; reason: string } {
  const message = error.message?.toLowerCase() || '';
  const status = (error as Error & { status?: number }).status;

  // Rate limit errors
  if (message.includes('rate limit') || message.includes('secondary rate limit') || status === 403) {
    return { retriable: true, reason: 'rate limit' };
  }

  // Timeout errors
  if (message.includes('couldn\'t respond') || message.includes('time') ||
      message.includes('timeout') || message.includes('timed out')) {
    return { retriable: true, reason: 'timeout' };
  }

  // Server errors (5xx)
  if (status && status >= 500 && status < 600) {
    return { retriable: true, reason: `server error (${status})` };
  }

  // Network errors
  if (message.includes('econnreset') || message.includes('enotfound') ||
      message.includes('socket') || message.includes('network')) {
    return { retriable: true, reason: 'network error' };
  }

  return { retriable: false, reason: '' };
}

/**
 * Retry a function with exponential backoff
 * @param fn - Async function to retry
 * @param maxRetries - Maximum number of retries
 * @param baseDelayMs - Base delay in milliseconds (doubles each retry)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  baseDelayMs: number = 3000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      const { retriable, reason } = isRetriableError(lastError);

      if (!retriable || attempt === maxRetries) {
        throw lastError;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt);
      console.warn(`${reason}, retrying in ${delayMs / 1000}s (attempt ${attempt + 1}/${maxRetries})...`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Process items sequentially with rate limiting (safer for REST API)
 * @param items - Array of items to process
 * @param delayMs - Delay in milliseconds between items
 * @param processor - Async function to process each item
 */
export async function processSequential<T, R>(
  items: T[],
  delayMs: number,
  processor: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i++) {
    const result = await withRetry(() => processor(items[i]));
    results.push(result);

    // Add delay between items (but not after the last item)
    if (i < items.length - 1) {
      await sleep(delayMs);
    }
  }

  return results;
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
