/**
 * One-off: reconstruct GitHub metrics for snapshot dates lost to a CI outage.
 *
 * Fetches current issues/PRs/commits plus stargazer + fork timestamps, then
 * for each gap date T rewinds the data to end-of-day T (drop everything
 * created after T, treat items closed/merged after T as still open) and runs
 * the normal metric calculators with the clock pinned to T. Existing snapshot
 * fields (e.g. downloads written by backfill-downloads --gap-only) are kept.
 *
 * Approximations: `isDraft` and labels reflect current state (no cheap
 * as-of history); `updatedAt` is rewound to the last visible activity when it
 * has moved past T; unstars/deleted forks are invisible; `contributors.total`
 * (needs the all-time roster's first-activity dates) and, when the commit
 * fetch cap truncates the window, `commits_per_week_avg` are interpolated
 * between the surrounding real snapshots; actionability (LLM classification)
 * is not reconstructed.
 *
 * Run: npm run build && node dist/backfill-github-gap.js --from=YYYY-MM-DD --to=YYYY-MM-DD [--force] [--repo=name]
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { loadConfig } from './config/loader.js';
import { createGitHubClient, withRetry } from './github/client.js';
import type { GitHubClient } from './github/client.js';
import { fetchMaintainers } from './github/maintainers.js';
import { fetchIssues } from './github/issues.js';
import { fetchPullRequests } from './github/pulls.js';
import { fetchCommits } from './github/commits.js';
import type { CommitData } from './github/commits.js';
import { calculateIssueMetrics } from './metrics/issues.js';
import { calculatePRMetrics } from './metrics/pulls.js';
import { calculateContributorMetrics } from './metrics/contributors.js';
import type {
  DailySnapshot,
  GitHubIssue,
  GitHubPullRequest,
  IssueData,
  PullRequestData,
  RepoConfig,
} from './types/index.js';

const DAY_MS = 86400000;
const COMMIT_FETCH_CAP = 500; // fetchCommits stops paginating here
const realNow = Date.now();

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

function endOfDay(date: string): number {
  return new Date(`${date}T23:59:59.999Z`).getTime();
}

function shiftDate(date: string, days: number): string {
  return new Date(new Date(date).getTime() + days * DAY_MS).toISOString().split('T')[0];
}

async function readSnapshot(dir: string, date: string): Promise<Partial<DailySnapshot> | null> {
  try {
    return JSON.parse(await readFile(join(dir, `${date}.json`), 'utf-8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Linear interpolation of a snapshot field between the real snapshots at `a` and `b`. */
function interpolate(
  before: number | undefined,
  after: number | undefined,
  a: string,
  b: string,
  date: string
): number | undefined {
  if (before === undefined || after === undefined) return before ?? after;
  const t = (new Date(date).getTime() - new Date(a).getTime()) / (new Date(b).getTime() - new Date(a).getTime());
  return Math.round(before + (after - before) * t);
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = new Date(from).getTime(); t <= new Date(to).getTime(); t += DAY_MS) {
    out.push(new Date(t).toISOString().split('T')[0]);
  }
  return out;
}

/** Timestamps (desc) of stars/forks so counts can be rewound past `since`. */
async function fetchEventTimestamps(
  client: GitHubClient,
  owner: string,
  repo: string,
  field: 'stargazers' | 'forks',
  since: number
): Promise<{ current: number; recent: number[] }> {
  const query = field === 'stargazers'
    ? `query($owner: String!, $repo: String!, $after: String) {
        repository(owner: $owner, name: $repo) {
          stargazerCount
          stargazers(first: 100, after: $after, orderBy: {field: STARRED_AT, direction: DESC}) {
            pageInfo { hasNextPage endCursor }
            edges { starredAt }
          }
        }
      }`
    : `query($owner: String!, $repo: String!, $after: String) {
        repository(owner: $owner, name: $repo) {
          forkCount
          forks(first: 100, after: $after, orderBy: {field: CREATED_AT, direction: DESC}) {
            pageInfo { hasNextPage endCursor }
            nodes { createdAt }
          }
        }
      }`;

  const recent: number[] = [];
  let after: string | null = null;
  let current = 0;
  for (;;) {
    const res: any = await withRetry(() => client.graphql(query, { owner, repo, after }));
    const repoData = res.repository;
    const conn = repoData[field];
    current = field === 'stargazers' ? repoData.stargazerCount : repoData.forkCount;
    const stamps: number[] = field === 'stargazers'
      ? conn.edges.map((e: { starredAt: string }) => new Date(e.starredAt).getTime())
      : conn.nodes.map((n: { createdAt: string }) => new Date(n.createdAt).getTime());
    recent.push(...stamps);
    const oldest = stamps.length ? Math.min(...stamps) : Infinity;
    if (!conn.pageInfo.hasNextPage || oldest < since) break;
    after = conn.pageInfo.endCursor;
  }
  return { current, recent };
}

function countAsOf(current: number, recent: number[], asOf: number): number {
  return current - recent.filter((t) => t > asOf).length;
}

/** Rewind issue data to its state at `asOf`. */
function issuesAsOf(all: GitHubIssue[], asOf: number): IssueData {
  const open: GitHubIssue[] = [];
  const closed: GitHubIssue[] = [];
  for (const issue of all) {
    if (new Date(issue.createdAt).getTime() > asOf) continue;
    const commentNodes = issue.comments.nodes.filter((c) => new Date(c.createdAt).getTime() <= asOf);
    const timelineItems = {
      nodes: issue.timelineItems.nodes.filter(
        (e) => !('createdAt' in e) || new Date((e as { createdAt: string }).createdAt).getTime() <= asOf
      ),
    };
    const closedThen = issue.closedAt !== null && new Date(issue.closedAt).getTime() <= asOf;
    // updatedAt has no history; if it moved past T, fall back to the last
    // activity we can see (comment, close, or creation) so staleness ages
    // aren't measured against future edits.
    let updatedAt = issue.updatedAt;
    if (new Date(updatedAt).getTime() > asOf) {
      const seen = [
        new Date(issue.createdAt).getTime(),
        ...commentNodes.map((c) => new Date(c.createdAt).getTime()),
        ...(closedThen ? [new Date(issue.closedAt!).getTime()] : []),
      ];
      updatedAt = new Date(Math.max(...seen)).toISOString();
    }
    const rewound: GitHubIssue = {
      ...issue,
      comments: { ...issue.comments, nodes: commentNodes, totalCount: commentNodes.length },
      timelineItems,
      updatedAt,
      state: closedThen ? 'CLOSED' : 'OPEN',
      closedAt: closedThen ? issue.closedAt : null,
    };
    (closedThen ? closed : open).push(rewound);
  }
  return { open, closed };
}

/** Rewind PR data to its state at `asOf`. */
function pullsAsOf(all: GitHubPullRequest[], asOf: number): PullRequestData {
  const open: GitHubPullRequest[] = [];
  const closed: GitHubPullRequest[] = [];
  for (const pr of all) {
    if (new Date(pr.createdAt).getTime() > asOf) continue;
    const mergedThen = pr.mergedAt !== null && new Date(pr.mergedAt).getTime() <= asOf;
    const closedThen = mergedThen || (pr.closedAt !== null && new Date(pr.closedAt).getTime() <= asOf);
    const reviewNodes = pr.reviews.nodes.filter((r) => new Date(r.createdAt).getTime() <= asOf);
    const commentNodes = pr.comments.nodes.filter((c) => new Date(c.createdAt).getTime() <= asOf);
    const rewound: GitHubPullRequest = {
      ...pr,
      reviews: { ...pr.reviews, nodes: reviewNodes, totalCount: reviewNodes.length },
      comments: { ...pr.comments, nodes: commentNodes, totalCount: commentNodes.length },
      state: mergedThen ? 'MERGED' : closedThen ? 'CLOSED' : 'OPEN',
      mergedAt: mergedThen ? pr.mergedAt : null,
      closedAt: closedThen ? pr.closedAt : null,
    };
    (closedThen ? closed : open).push(rewound);
  }
  return { open, closed };
}

async function main() {
  const from = arg('from');
  const to = arg('to');
  const force = process.argv.includes('--force');
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!from || !to || !isoDate.test(from) || !isoDate.test(to) || from > to) {
    throw new Error('usage: --from=YYYY-MM-DD --to=YYYY-MM-DD (from <= to)');
  }
  const gapDates = datesBetween(from, to);
  const oldest = endOfDay(gapDates[0]);

  const client = createGitHubClient();
  const config = await loadConfig();
  const maintainers = await fetchMaintainers(client, false);
  const maintainerSet = new Set(maintainers.maintainers.map((m) => m.github));

  const onlyRepo = arg('repo');
  for (const repoConfig of config.repositories) {
    const { owner, repo } = repoConfig;
    if (onlyRepo && repo !== onlyRepo) continue;
    console.log(`\n[${owner}/${repo}]`);

    // Shift the clock so the 90-day cutoff on closed issues/PRs reaches back
    // from the oldest gap date, not from today.
    Date.now = () => oldest - DAY_MS;
    const issues = await fetchIssues(client, owner, repo, false);
    const pulls = await fetchPullRequests(client, owner, repo, false);
    Date.now = () => realNow;
    // 12 weeks of commit history relative to the oldest gap date.
    const weeks = 12 + Math.ceil((realNow - oldest) / (7 * DAY_MS)) + 1;
    const { commits } = await fetchCommits(client, owner, repo, weeks, false);
    const stars = await fetchEventTimestamps(client, owner, repo, 'stargazers', oldest - DAY_MS);
    const forks = await fetchEventTimestamps(client, owner, repo, 'forks', oldest - DAY_MS);
    console.log(
      `  fetched ${issues.open.length + issues.closed.length} issues, ` +
      `${pulls.open.length + pulls.closed.length} PRs, ${commits.length} commits, ` +
      `${stars.recent.length} recent stars, ${forks.recent.length} recent forks`
    );

    const allIssues = [...issues.open, ...issues.closed];
    const allPRs = [...pulls.open, ...pulls.closed];
    const snapDir = join('data', 'repos', owner, repo, 'snapshots');
    await mkdir(snapDir, { recursive: true });

    // Anchor snapshots on either side of the gap, used to interpolate the
    // couple of fields that can't be rewound from timestamps.
    const beforeDate = shiftDate(from, -1);
    const afterDate = shiftDate(to, 1);
    const before = await readSnapshot(snapDir, beforeDate);
    const after = await readSnapshot(snapDir, afterDate);
    const commitsCapped = commits.length >= COMMIT_FETCH_CAP;

    for (const date of gapDates) {
      const asOf = endOfDay(date);
      Date.now = () => asOf;
      const dayIssues = issuesAsOf(allIssues, asOf);
      const dayPulls = pullsAsOf(allPRs, asOf);
      const dayCommits: CommitData[] = commits.filter((c) => new Date(c.committedDate).getTime() <= asOf);
      const issueMetrics = calculateIssueMetrics(dayIssues, maintainerSet, owner, repo);
      const prMetrics = calculatePRMetrics(dayPulls, maintainerSet, owner, repo);
      const contributorMetrics = await calculateContributorMetrics(dayIssues, dayPulls, dayCommits, maintainerSet, repoConfig as RepoConfig);
      Date.now = () => realNow;

      const path = join(snapDir, `${date}.json`);
      const existing = await readSnapshot(snapDir, date);
      const snapshot: Partial<DailySnapshot> = existing ?? { date };
      if (snapshot.issues && !force) {
        console.log(`  ${date}: already has GitHub metrics, skipping (use --force to overwrite)`);
        continue;
      }

      snapshot.issues = {
        open: issueMetrics.open_count,
        closed_7d: issueMetrics.closed_7d,
        closed_30d: issueMetrics.closed_30d,
        closed_90d: issueMetrics.closed_90d,
        opened_7d: issueMetrics.opened_7d,
        opened_30d: issueMetrics.opened_30d,
        opened_90d: issueMetrics.opened_90d,
        without_response_24h: issueMetrics.without_response_24h,
        without_response_7d: issueMetrics.without_response_7d,
        without_response_30d: issueMetrics.without_response_30d,
        stale_30d: issueMetrics.stale_30d,
        stale_60d: issueMetrics.stale_60d,
        stale_90d: issueMetrics.stale_90d,
        reopen_rate: issueMetrics.reopen_rate,
        response_time: issueMetrics.response_time,
        close_time: issueMetrics.close_time,
        label_coverage_pct: issueMetrics.label_coverage_pct,
      };
      snapshot.pulls = {
        open: prMetrics.open_count,
        merged_7d: prMetrics.merged_7d,
        merged_30d: prMetrics.merged_30d,
        merged_90d: prMetrics.merged_90d,
        opened_7d: prMetrics.opened_7d,
        opened_30d: prMetrics.opened_30d,
        opened_90d: prMetrics.opened_90d,
        closed_not_merged_90d: prMetrics.closed_not_merged_90d,
        draft_count: prMetrics.draft_count,
        without_review_24h: prMetrics.without_review_24h,
        without_review_7d: prMetrics.without_review_7d,
        review_time: prMetrics.review_time,
        merge_time: prMetrics.merge_time,
        code_review_rate_pct: prMetrics.code_review_rate_pct,
        rejection_rate_pct: prMetrics.rejection_rate_pct,
        avg_reviews_per_pr: prMetrics.avg_reviews_per_pr,
        by_size: prMetrics.by_size,
      };
      snapshot.repository = {
        stars: countAsOf(stars.current, stars.recent, asOf),
        forks: countAsOf(forks.current, forks.recent, asOf),
      };
      snapshot.contributors = {
        // loadContributors() unions in today's all-time roster, so the raw
        // total is anachronistic; interpolate between the real neighbors.
        total: interpolate(before?.contributors?.total, after?.contributors?.total, beforeDate, afterDate, date)
          ?? contributorMetrics.total_known,
        active_30d: contributorMetrics.active_30d,
        first_time_30d: contributorMetrics.first_time_30d,
        retention_rate_pct: contributorMetrics.retention_rate_pct,
        churned_30d: contributorMetrics.churned_30d,
        // When the commit fetch hit its cap, the oldest weeks of the trailing
        // 12-week window are missing for early gap dates; interpolate instead.
        commits_per_week_avg: commitsCapped
          ? interpolate(before?.contributors?.commits_per_week_avg, after?.contributors?.commits_per_week_avg, beforeDate, afterDate, date)
            ?? contributorMetrics.commits_per_week_avg
          : contributorMetrics.commits_per_week_avg,
        active_maintainers_30d: contributorMetrics.active_maintainers_30d,
        active_community_30d: contributorMetrics.active_community_30d,
      };

      await writeFile(path, JSON.stringify(snapshot, null, 2));
      console.log(`  ${date}: issues.open=${issueMetrics.open_count} pulls.open=${prMetrics.open_count} stars=${snapshot.repository.stars}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
