/**
 * Calculate pull request metrics
 */

import type { PullRequestData, PRMetrics, GitHubPullRequest } from '../types/index.js';
import { average, median, percentile, msToHours, round } from '../utils/stats.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// Size thresholds (lines changed)
const SMALL_THRESHOLD = 100;
const MEDIUM_THRESHOLD = 500;

/**
 * Check if a reviewer is a bot
 */
function isBot(login: string | undefined): boolean {
  if (!login) return true;
  return login.endsWith('[bot]') || login.includes('bot');
}

/**
 * Calculate time to first maintainer review for a PR
 */
function getTimeToFirstMaintainerReview(
  pr: GitHubPullRequest,
  maintainerSet: Set<string>
): number | null {
  const prAuthor = pr.author?.login;

  // Find first eligible review from a maintainer
  const eligibleReviews = pr.reviews.nodes
    .filter((review) => {
      const author = review.author?.login;
      if (!author) return false;
      if (author === prAuthor) return false; // Exclude self-reviews
      if (isBot(author)) return false;
      if (!maintainerSet.has(author)) return false;
      return true;
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (eligibleReviews.length === 0) return null;

  const firstReview = new Date(eligibleReviews[0].createdAt).getTime();
  const prCreated = new Date(pr.createdAt).getTime();

  return firstReview - prCreated;
}

/**
 * Get PR size category based on lines changed
 */
function getPRSize(pr: GitHubPullRequest): 'small' | 'medium' | 'large' {
  const totalLines = pr.additions + pr.deletions;
  if (totalLines < SMALL_THRESHOLD) return 'small';
  if (totalLines < MEDIUM_THRESHOLD) return 'medium';
  return 'large';
}

/**
 * Calculate all PR metrics
 */
export function calculatePRMetrics(
  pulls: PullRequestData,
  maintainerSet: Set<string>
): PRMetrics {
  const now = Date.now();

  // Separate merged and closed-not-merged
  const mergedPRs = pulls.closed.filter((pr) => pr.mergedAt !== null);
  const closedNotMerged = pulls.closed.filter((pr) => pr.mergedAt === null);

  // Volume metrics
  const open_count = pulls.open.length;
  const merged_7d = mergedPRs.filter(
    (pr) => pr.mergedAt && now - new Date(pr.mergedAt).getTime() < SEVEN_DAYS_MS
  ).length;
  const merged_30d = mergedPRs.filter(
    (pr) => pr.mergedAt && now - new Date(pr.mergedAt).getTime() < THIRTY_DAYS_MS
  ).length;
  const merged_90d = mergedPRs.filter(
    (pr) => pr.mergedAt && now - new Date(pr.mergedAt).getTime() < NINETY_DAYS_MS
  ).length;
  const closed_not_merged_90d = closedNotMerged.filter(
    (pr) => pr.closedAt && now - new Date(pr.closedAt).getTime() < NINETY_DAYS_MS
  ).length;

  // PRs opened in time windows (for calculating merge rate percentages)
  const allPRs = [...pulls.open, ...pulls.closed];
  const opened_7d = allPRs.filter(
    (pr) => now - new Date(pr.createdAt).getTime() < SEVEN_DAYS_MS
  ).length;
  const opened_30d = allPRs.filter(
    (pr) => now - new Date(pr.createdAt).getTime() < THIRTY_DAYS_MS
  ).length;
  const opened_90d = allPRs.filter(
    (pr) => now - new Date(pr.createdAt).getTime() < NINETY_DAYS_MS
  ).length;

  // Draft count (only for open PRs)
  const draft_count = pulls.open.filter((pr) => pr.isDraft).length;

  // Review time metrics
  const reviewTimes: number[] = [];
  let without_review_24h = 0;
  let without_review_7d = 0;

  // Check open non-draft PRs for review status
  for (const pr of pulls.open) {
    if (pr.isDraft) continue; // Skip draft PRs

    const reviewTime = getTimeToFirstMaintainerReview(pr, maintainerSet);
    if (reviewTime !== null) {
      reviewTimes.push(reviewTime);
    } else {
      // No maintainer review yet
      const age = now - new Date(pr.createdAt).getTime();
      if (age > TWENTY_FOUR_HOURS_MS) without_review_24h++;
      if (age > SEVEN_DAYS_MS) without_review_7d++;
    }
  }

  // Also include review times from merged PRs
  for (const pr of mergedPRs) {
    const reviewTime = getTimeToFirstMaintainerReview(pr, maintainerSet);
    if (reviewTime !== null) {
      reviewTimes.push(reviewTime);
    }
  }

  const sortedReviewTimes = reviewTimes.map((t) => msToHours(t)).sort((a, b) => a - b);

  // Merge time metrics (time from creation to merge)
  const mergeTimes = mergedPRs
    .filter((pr) => pr.mergedAt)
    .map((pr) => {
      const created = new Date(pr.createdAt).getTime();
      const merged = new Date(pr.mergedAt!).getTime();
      return msToHours(merged - created);
    })
    .sort((a, b) => a - b);

  // Size breakdown (for open PRs)
  const by_size = {
    small: 0,
    medium: 0,
    large: 0,
  };

  for (const pr of pulls.open) {
    const size = getPRSize(pr);
    by_size[size]++;
  }

  return {
    open_count,
    merged_7d,
    merged_30d,
    merged_90d,
    opened_7d,
    opened_30d,
    opened_90d,
    closed_not_merged_90d,
    draft_count,
    without_review_24h,
    without_review_7d,
    review_time: {
      avg_hours: round(average(sortedReviewTimes)),
      median_hours: round(median(sortedReviewTimes)),
      p90_hours: round(percentile(sortedReviewTimes, 90)),
      p95_hours: round(percentile(sortedReviewTimes, 95)),
    },
    merge_time: {
      avg_hours: round(average(mergeTimes)),
      median_hours: round(median(mergeTimes)),
    },
    by_size,
  };
}
