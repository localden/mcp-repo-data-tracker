/**
 * Calculate contributor metrics
 *
 * Tracks active contributors from issues, PRs, and commits.
 * Excludes bots and provides maintainer/community breakdown.
 */

import type {
  IssueData,
  PullRequestData,
  ContributorMetrics,
  RepoConfig,
} from '../types/index.js';
import { loadContributors, loadPreviousPeriodContributors, savePreviousPeriodContributors } from '../data/writers.js';
import type { CommitData } from '../github/commits.js';
import { groupCommitsByWeek } from '../github/commits.js';
import { round, average } from '../utils/stats.js';
import { isBot } from '../utils/bots.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const ONE_TWENTY_DAYS_MS = 120 * 24 * 60 * 60 * 1000;

/**
 * Calculate contributor metrics
 *
 * @param issues - Issue data from GitHub
 * @param pulls - Pull request data from GitHub
 * @param commits - Commit data from GitHub
 * @param maintainerSet - Set of known maintainer GitHub usernames
 * @param repoConfig - Repository configuration
 */
export async function calculateContributorMetrics(
  issues: IssueData,
  pulls: PullRequestData,
  commits: CommitData[],
  maintainerSet: Set<string>,
  repoConfig?: RepoConfig
): Promise<ContributorMetrics> {
  const now = Date.now();
  const existingContributors = new Set(await loadContributors(repoConfig));
  const previousPeriodContributors = new Set(await loadPreviousPeriodContributors(repoConfig));

  // Collect all contributors from current data
  const currentContributors = new Set<string>();
  const activeContributors = new Set<string>();
  const prevWindowContributors = new Set<string>(); // Active 30-60 days ago
  // Contributors with activity in the 90-day window before current 30-day period (days 30-120 ago)
  const recentHistoryContributors = new Set<string>();
  const newContributors = new Set<string>();

  /**
   * Process a contributor's activity
   */
  function processContribution(author: string | undefined, activityTime: number): void {
    if (!author || isBot(author)) return;

    currentContributors.add(author);
    const age = now - activityTime;

    // Check if active (activity in last 30 days)
    if (age < THIRTY_DAYS_MS) {
      activeContributors.add(author);
    }

    // Check if active in previous period (30-60 days ago) - for retention fallback
    if (age >= THIRTY_DAYS_MS && age < SIXTY_DAYS_MS) {
      prevWindowContributors.add(author);
    }

    // Track 90-day history window (30-120 days ago) for first-time detection
    if (age >= THIRTY_DAYS_MS && age < ONE_TWENTY_DAYS_MS) {
      recentHistoryContributors.add(author);
    }
  }

  // Process issues
  for (const issue of [...issues.open, ...issues.closed]) {
    const author = issue.author?.login;
    const createdAt = new Date(issue.createdAt).getTime();
    processContribution(author, createdAt);
  }

  // Process PRs
  for (const pr of [...pulls.open, ...pulls.closed]) {
    const author = pr.author?.login;
    const createdAt = new Date(pr.createdAt).getTime();
    processContribution(author, createdAt);
  }

  // Process commits - this captures maintainers who commit but don't open PRs
  for (const commit of commits) {
    const author = commit.author?.user?.login;
    const commitTime = new Date(commit.committedDate).getTime();
    processContribution(author, commitTime);
  }

  // Determine first-time contributors
  // A "first-time" contributor is active in the current 30 days but had no activity
  // in the 90-day window before that (days 30-120 ago)
  for (const contributor of activeContributors) {
    if (!recentHistoryContributors.has(contributor)) {
      newContributors.add(contributor);
    }
  }

  // Calculate retention rate
  // If we have previous period data from last run, compare current active against it
  // Otherwise, use the contributors from 30-60 days ago as a proxy
  let retentionBase: Set<string>;
  if (previousPeriodContributors.size > 0) {
    retentionBase = previousPeriodContributors;
  } else {
    retentionBase = prevWindowContributors;
  }

  let retained = 0;
  for (const contributor of retentionBase) {
    if (activeContributors.has(contributor)) {
      retained++;
    }
  }

  const retention_rate_pct = retentionBase.size > 0
    ? round((retained / retentionBase.size) * 100, 1)
    : 0;

  const churned_30d = retentionBase.size - retained;

  // Commit frequency analysis
  const commitTrend = groupCommitsByWeek(commits, 12);
  const commits_per_week_avg = round(average(commitTrend), 1);

  // Merge with existing contributors for the full list (excluding bots)
  const allContributors = new Set<string>();
  for (const contributor of existingContributors) {
    if (!isBot(contributor)) {
      allContributors.add(contributor);
    }
  }
  for (const contributor of currentContributors) {
    allContributors.add(contributor);
  }

  // Calculate maintainer vs community breakdown
  let active_maintainers_30d = 0;
  for (const contributor of activeContributors) {
    if (maintainerSet.has(contributor)) {
      active_maintainers_30d++;
    }
  }
  const active_community_30d = activeContributors.size - active_maintainers_30d;

  // Save current active contributors for next period's retention calculation
  await savePreviousPeriodContributors(Array.from(activeContributors), repoConfig);

  return {
    total_known: allContributors.size,
    active_30d: activeContributors.size,
    first_time_30d: newContributors.size,
    retention_rate_pct,
    churned_30d,
    commits_per_week_avg,
    commits_per_week_trend: commitTrend,
    active_maintainers_30d,
    active_community_30d,
    allContributors: Array.from(allContributors).sort(),
    previousPeriodContributors: Array.from(activeContributors).sort(),
  };
}
