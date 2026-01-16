/**
 * Calculate pull request metrics
 */

import type { PullRequestData, PRMetrics, GitHubPullRequest, PRNeedingAttention } from '../types/index.js';
import { average, median, percentile, msToHours, round } from '../utils/stats.js';
import { isBot } from '../utils/bots.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// Size thresholds (lines changed)
const SMALL_THRESHOLD = 100;
const MEDIUM_THRESHOLD = 500;

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
  maintainerSet: Set<string>,
  owner?: string,
  repo?: string
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
  const prsWithoutMaintainerReview: PRNeedingAttention[] = [];

  // Check open non-draft PRs for review status
  for (const pr of pulls.open) {
    const reviewTime = getTimeToFirstMaintainerReview(pr, maintainerSet);
    if (reviewTime !== null) {
      if (!pr.isDraft) {
        reviewTimes.push(reviewTime);
      }
    } else {
      // No maintainer review yet - collect this PR
      const age = now - new Date(pr.createdAt).getTime();
      const daysWaiting = Math.floor(age / (24 * 60 * 60 * 1000));

      prsWithoutMaintainerReview.push({
        number: pr.number,
        title: pr.title,
        url: owner && repo
          ? `https://github.com/${owner}/${repo}/pull/${pr.number}`
          : `#${pr.number}`,
        createdAt: pr.createdAt,
        daysWaiting,
        labels: pr.labels.nodes.map(l => l.name),
        isDraft: pr.isDraft,
        additions: pr.additions,
        deletions: pr.deletions,
        reviewCount: pr.reviews.totalCount,
        author: pr.author?.login || null,
      });

      if (!pr.isDraft) {
        if (age > TWENTY_FOUR_HOURS_MS) without_review_24h++;
        if (age > SEVEN_DAYS_MS) without_review_7d++;
      }
    }
  }

  // Sort by oldest first (most days waiting)
  prsWithoutMaintainerReview.sort((a, b) => b.daysWaiting - a.daysWaiting);

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

  // Code review rate: % of merged PRs (in 90d) that had at least one review
  const mergedWithReview = mergedPRs.filter(
    (pr) => pr.mergedAt && now - new Date(pr.mergedAt).getTime() < NINETY_DAYS_MS && pr.reviews.totalCount > 0
  ).length;
  const code_review_rate_pct = merged_90d > 0
    ? round((mergedWithReview / merged_90d) * 100, 1)
    : 0;

  // PR rejection rate: % of closed PRs (in 90d) that were not merged
  const totalClosed90d = merged_90d + closed_not_merged_90d;
  const rejection_rate_pct = totalClosed90d > 0
    ? round((closed_not_merged_90d / totalClosed90d) * 100, 1)
    : 0;

  // Average reviews per merged PR (in 90d)
  const recentMergedPRs = mergedPRs.filter(
    (pr) => pr.mergedAt && now - new Date(pr.mergedAt).getTime() < NINETY_DAYS_MS
  );
  const totalReviews = recentMergedPRs.reduce((sum, pr) => sum + pr.reviews.totalCount, 0);
  const avg_reviews_per_pr = recentMergedPRs.length > 0
    ? round(totalReviews / recentMergedPRs.length, 1)
    : 0;

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
    prs_without_maintainer_review: prsWithoutMaintainerReview,
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
    code_review_rate_pct,
    rejection_rate_pct,
    avg_reviews_per_pr,
    by_size,
  };
}
