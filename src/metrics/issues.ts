/**
 * Calculate issue metrics
 */

import type { IssueData, IssueMetrics, GitHubIssue, IssueNeedingAttention } from '../types/index.js';
import { average, median, percentile, msToHours, msToDays, round } from '../utils/stats.js';
import { isBot } from '../utils/bots.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Calculate time to first maintainer response for an issue
 */
function getTimeToFirstMaintainerResponse(
  issue: GitHubIssue,
  maintainerSet: Set<string>
): number | null {
  const issueAuthor = issue.author?.login;

  // Find first eligible comment from a maintainer
  const eligibleComments = issue.comments.nodes
    .filter((comment) => {
      const author = comment.author?.login;
      if (!author) return false;
      if (author === issueAuthor) return false; // Exclude self-comments
      if (isBot(author)) return false;
      if (!maintainerSet.has(author)) return false;
      return true;
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (eligibleComments.length === 0) return null;

  const firstResponse = new Date(eligibleComments[0].createdAt).getTime();
  const issueCreated = new Date(issue.createdAt).getTime();

  return firstResponse - issueCreated;
}

/**
 * Check if an issue has been reopened
 */
function hasBeenReopened(issue: GitHubIssue): boolean {
  return issue.timelineItems.nodes.some(
    (event) => event.__typename === 'ReopenedEvent' || 'createdAt' in event
  );
}

/**
 * Calculate all issue metrics
 */
export function calculateIssueMetrics(
  issues: IssueData,
  maintainerSet: Set<string>,
  owner?: string,
  repo?: string
): IssueMetrics {
  const now = Date.now();
  const allIssues = [...issues.open, ...issues.closed];
  const closedIssues = issues.closed;

  // Volume metrics
  const open_count = issues.open.length;
  const closed_7d = closedIssues.filter(
    (i) => i.closedAt && now - new Date(i.closedAt).getTime() < SEVEN_DAYS_MS
  ).length;
  const closed_30d = closedIssues.filter(
    (i) => i.closedAt && now - new Date(i.closedAt).getTime() < THIRTY_DAYS_MS
  ).length;
  const closed_90d = closedIssues.filter(
    (i) => i.closedAt && now - new Date(i.closedAt).getTime() < NINETY_DAYS_MS
  ).length;

  // Issues opened in time windows (for calculating close rate percentages)
  const opened_7d = allIssues.filter(
    (i) => now - new Date(i.createdAt).getTime() < SEVEN_DAYS_MS
  ).length;
  const opened_30d = allIssues.filter(
    (i) => now - new Date(i.createdAt).getTime() < THIRTY_DAYS_MS
  ).length;
  const opened_90d = allIssues.filter(
    (i) => now - new Date(i.createdAt).getTime() < NINETY_DAYS_MS
  ).length;

  // Response time metrics
  const responseTimes: number[] = [];
  let without_response_24h = 0;
  let without_response_7d = 0;
  let without_response_30d = 0;
  const issuesWithoutMaintainerResponse: IssueNeedingAttention[] = [];

  for (const issue of issues.open) {
    const responseTime = getTimeToFirstMaintainerResponse(issue, maintainerSet);
    if (responseTime !== null) {
      responseTimes.push(responseTime);
    } else {
      // No maintainer response yet - collect this issue
      const age = now - new Date(issue.createdAt).getTime();
      const daysWaiting = Math.floor(age / (24 * 60 * 60 * 1000));

      issuesWithoutMaintainerResponse.push({
        number: issue.number,
        title: issue.title,
        url: owner && repo
          ? `https://github.com/${owner}/${repo}/issues/${issue.number}`
          : `#${issue.number}`,
        createdAt: issue.createdAt,
        daysWaiting,
        labels: issue.labels.nodes.map(l => l.name),
        commentCount: issue.comments.totalCount,
      });

      if (age > TWENTY_FOUR_HOURS_MS) without_response_24h++;
      if (age > SEVEN_DAYS_MS) without_response_7d++;
      if (age > THIRTY_DAYS_MS) without_response_30d++;
    }
  }

  // Sort by oldest first (most days waiting)
  issuesWithoutMaintainerResponse.sort((a, b) => b.daysWaiting - a.daysWaiting);

  // Also check recently closed issues for response times
  for (const issue of closedIssues) {
    const responseTime = getTimeToFirstMaintainerResponse(issue, maintainerSet);
    if (responseTime !== null) {
      responseTimes.push(responseTime);
    }
  }

  const sortedResponseTimes = responseTimes
    .map((t) => msToHours(t))
    .sort((a, b) => a - b);

  // Label breakdown and coverage
  const by_label: Record<string, number> = {};
  let labeledCount = 0;
  for (const issue of issues.open) {
    const hasLabels = issue.labels.nodes.length > 0;
    if (hasLabels) {
      labeledCount++;
      for (const label of issue.labels.nodes) {
        by_label[label.name] = (by_label[label.name] || 0) + 1;
      }
    }
  }
  const unlabeled_count = issues.open.length - labeledCount;
  const label_coverage_pct = issues.open.length > 0
    ? round((labeledCount / issues.open.length) * 100, 1)
    : 0;

  // Time to close (for recently closed issues)
  const closeTimes = closedIssues
    .filter((i) => i.closedAt)
    .map((i) => {
      const created = new Date(i.createdAt).getTime();
      const closed = new Date(i.closedAt!).getTime();
      return msToDays(closed - created);
    })
    .sort((a, b) => a - b);

  // Stale issues (open issues without recent activity)
  let stale_30d = 0;
  let stale_60d = 0;
  let stale_90d = 0;

  for (const issue of issues.open) {
    const age = now - new Date(issue.updatedAt).getTime();
    if (age > THIRTY_DAYS_MS) stale_30d++;
    if (age > SIXTY_DAYS_MS) stale_60d++;
    if (age > NINETY_DAYS_MS) stale_90d++;
  }

  // Reopen rate
  const reopenedCount = closedIssues.filter(hasBeenReopened).length;
  const reopen_rate = closedIssues.length > 0 ? round(reopenedCount / closedIssues.length, 2) : 0;

  return {
    open_count,
    closed_7d,
    closed_30d,
    closed_90d,
    opened_7d,
    opened_30d,
    opened_90d,
    without_response_24h,
    without_response_7d,
    without_response_30d,
    issues_without_maintainer_response: issuesWithoutMaintainerResponse,
    by_label,
    response_time: {
      avg_hours: round(average(sortedResponseTimes)),
      median_hours: round(median(sortedResponseTimes)),
      p90_hours: round(percentile(sortedResponseTimes, 90)),
      p95_hours: round(percentile(sortedResponseTimes, 95)),
    },
    close_time: {
      avg_days: round(average(closeTimes)),
      median_days: round(median(closeTimes)),
      p90_days: round(percentile(closeTimes, 90)),
    },
    label_coverage_pct,
    unlabeled_count,
    stale_30d,
    stale_60d,
    stale_90d,
    reopen_rate,
  };
}
