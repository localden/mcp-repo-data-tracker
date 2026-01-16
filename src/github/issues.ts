/**
 * Fetch issues from GitHub repository
 */

import type { GitHubClient } from './client.js';
import { sleep } from './client.js';
import type { GitHubIssue, GitHubComment, IssueData } from '../types/index.js';
import { FETCH_ISSUES_QUERY, FETCH_ISSUE_COMMENTS_QUERY } from './queries.js';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
// Delay between paginated requests to avoid secondary rate limits
const PAGE_DELAY_MS = 300;

interface IssuesQueryResponse {
  repository: {
    issues: {
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
      nodes: GitHubIssue[];
    };
  };
}

interface CommentsQueryResponse {
  node: {
    comments: {
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
      nodes: GitHubComment[];
    };
  };
}

/**
 * Fetch all issues from a repository
 */
export async function fetchIssues(
  client: GitHubClient,
  owner: string,
  repo: string,
  verbose: boolean
): Promise<IssueData> {
  const openIssues = await fetchIssuesByState(client, owner, repo, ['OPEN'], verbose);
  const closedIssues = await fetchIssuesByState(client, owner, repo, ['CLOSED'], verbose, true);

  return {
    open: openIssues,
    closed: closedIssues,
  };
}

/**
 * Fetch issues by state with pagination
 */
async function fetchIssuesByState(
  client: GitHubClient,
  owner: string,
  repo: string,
  states: string[],
  verbose: boolean,
  stopAtCutoff = false
): Promise<GitHubIssue[]> {
  const issues: GitHubIssue[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  const cutoffDate = new Date(Date.now() - NINETY_DAYS_MS);

  while (hasNextPage) {
    const response: IssuesQueryResponse = await client.graphql(FETCH_ISSUES_QUERY, {
      owner,
      repo,
      after: cursor,
      states,
    });

    const pageInfo = response.repository.issues.pageInfo;
    const nodes = response.repository.issues.nodes;

    for (const issue of nodes) {
      // For closed issues, stop when we reach issues updated before the cutoff
      if (stopAtCutoff && new Date(issue.updatedAt) < cutoffDate) {
        hasNextPage = false;
        break;
      }

      // Fetch additional comments if needed
      if (issue.comments.totalCount > 100 && issue.comments.pageInfo.hasNextPage) {
        const additionalComments = await fetchAdditionalComments(
          client,
          issue.id,
          issue.comments.pageInfo.endCursor,
          verbose
        );
        issue.comments.nodes.push(...additionalComments);
      }

      issues.push(issue);
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
      console.log(`    Fetched ${issues.length} ${states.join('/')} issues...`);
    }
  }

  return issues;
}

/**
 * Fetch additional comments for issues with >100 comments
 */
async function fetchAdditionalComments(
  client: GitHubClient,
  issueId: string,
  cursor: string | null,
  verbose: boolean
): Promise<GitHubComment[]> {
  const comments: GitHubComment[] = [];
  let hasNextPage = true;
  let currentCursor = cursor;

  while (hasNextPage) {
    const response = await client.graphql<CommentsQueryResponse>(FETCH_ISSUE_COMMENTS_QUERY, {
      issueId,
      after: currentCursor,
    });

    const { pageInfo, nodes } = response.node.comments;
    comments.push(...nodes);

    hasNextPage = pageInfo.hasNextPage;
    currentCursor = pageInfo.endCursor;

    // Add delay between pages
    if (hasNextPage) {
      await sleep(PAGE_DELAY_MS);
    }

    if (verbose) {
      console.log(`      Fetched ${comments.length} additional comments...`);
    }
  }

  return comments;
}
