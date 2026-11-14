/**
 * One-off: reconstruct GitHub metrics for snapshot dates lost to a CI outage.
 *
 * Fetches current issues/PRs/commits plus stargazer + fork timestamps, then
 * for each gap date T rewinds the data to end-of-day T (drop everything
 * created after T, treat items closed/merged after T as still open) and runs
 * the normal metric calculators with the clock pinned to T. Existing snapshot
 * fields (e.g. download stubs) are kept, and only dates whose snapshot has no
 * `issues` block are filled unless --force.
 *
 * Every snapshot written carries meta: {source: 'reconstructed', approx}.
 * Fields with no cheap as-of history are written as null: stale_* (updatedAt
 * has no history), label_coverage_pct, draft_count and by_size (labels and
 * draft state are today's). `contributors.total` (needs the all-time roster's
 * first-activity dates) is interpolated between the real snapshots either
 * side of the range, or null when one is missing. `commits_per_week_avg` is
 * exact unless the commit fetch stopped short of T's 12-week window; then it
 * is interpolated the same way and added to `approx`. Unstars/deleted forks
 * are invisible; actionability (LLM classification) is not reconstructed.
 *
 * Run: npm run build && node dist/backfill-github-gap.js --from=YYYY-MM-DD --to=YYYY-MM-DD [--force] [--repo=name]
 * CI: .github/workflows/backfill-github-gap.yml (dry run by default).
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
const COMMIT_WINDOW_MS = 12 * 7 * DAY_MS; // calculateContributorMetrics' commit trend window
const realNow = Date.now();

/** Fields that can't be rebuilt from timestamps; listed in meta.approx on every reconstructed snapshot. */
const APPROX_FIELDS = ['stale_30d', 'stale_60d', 'stale_90d', 'label_coverage_pct', 'draft_count', 'by_size', 'contributors.total'];
/** The subset of APPROX_FIELDS always written as null (for the summary). */
const NULL_FIELDS = ['issues.stale_30d', 'issues.stale_60d', 'issues.stale_90d', 'issues.label_coverage_pct', 'pulls.draft_count', 'pulls.by_size'];

/**
 * Snapshot shape this tool reads and writes. Blocks are Partial so fields
 * added to DailySnapshot later are simply absent on reconstructed dates
 * rather than a compile error; the fields above that can't be rewound are
 * nullable.
 */
type WithNull<T, K extends keyof T> = Omit<T, K> & { [P in K]: T[P] | null };
type ReconstructedSnapshot = Omit<Partial<DailySnapshot>, 'issues' | 'pulls' | 'contributors' | 'meta'> & {
  issues?: WithNull<Partial<DailySnapshot['issues']>, 'stale_30d' | 'stale_60d' | 'stale_90d' | 'label_coverage_pct'>;
  pulls?: WithNull<Partial<DailySnapshot['pulls']>, 'draft_count' | 'by_size'>;
  contributors?: WithNull<Partial<DailySnapshot['contributors']>, 'total' | 'commits_per_week_avg'>;
  meta?: { source: string; approx?: string[] };
};

/** Per-repo tallies for the end-of-run summary the workflow's dry run prints. */
interface RepoTally {
  repo: string;
  written: number;
  created: number;
  skipped: number;
  totalNull: number;
  cpwInterpolated: number;
  cpwNull: number;
}

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

function endOfDay(date: string): number {
  return new Date(`${date}T23:59:59.999Z`).getTime();
}

function shiftDate(date: string, days: number): string {
  return new Date(new Date(date).getTime() + days * DAY_MS).toISOString().split('T')[0];
}

async function readSnapshot(dir: string, date: string): Promise<ReconstructedSnapshot | null> {
  try {
    return JSON.parse(await readFile(join(dir, `${date}.json`), 'utf-8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** A neighbour snapshot to interpolate from: null when missing or itself reconstructed. */
async function readRealSnapshot(dir: string, date: string): Promise<ReconstructedSnapshot | null> {
  const snap = await readSnapshot(dir, date);
  return snap?.meta?.source === 'reconstructed' ? null : snap;
}

/**
 * Linear interpolation of a snapshot field between the real snapshots at `a`
 * and `b`. Undefined when either side is missing: a flat copy of one
 * neighbour would read as a measured value.
 */
function interpolate(
  before: number | null | undefined,
  after: number | null | undefined,
  a: string,
  b: string,
  date: string,
  decimals = 0
): number | undefined {
  if (before == null || after == null) return undefined;
  const t = (new Date(date).getTime() - new Date(a).getTime()) / (new Date(b).getTime() - new Date(a).getTime());
  const scale = 10 ** decimals;
  return Math.round((before + (after - before) * t) * scale) / scale;
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
    // aren't measured against future edits. Other edits stay invisible, so
    // stale_* is still written as null (APPROX_FIELDS).
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
  const today = new Date(realNow).toISOString().split('T')[0];
  if (to >= today) {
    throw new Error(`--to must be before today (${today}); the aggregate run owns today's snapshot`);
  }
  const gapDates = datesBetween(from, to);
  const oldest = endOfDay(gapDates[0]);

  const client = createGitHubClient();
  const config = await loadConfig();
  const maintainers = await fetchMaintainers(client, false);
  const maintainerSet = new Set(maintainers.maintainers.map((m) => m.github.toLowerCase()));

  const onlyRepo = arg('repo');
  if (onlyRepo && !config.repositories.some((r) => r.repo === onlyRepo)) {
    throw new Error(`--repo=${onlyRepo} is not a configured repository`);
  }
  const tallies: RepoTally[] = [];
  let sample: ReconstructedSnapshot | undefined;
  for (const repoConfig of config.repositories) {
    const { owner, repo } = repoConfig;
    if (onlyRepo && repo !== onlyRepo) continue;
    console.log(`\n[${owner}/${repo}]`);
    const tally: RepoTally = { repo, written: 0, created: 0, skipped: 0, totalNull: 0, cpwInterpolated: 0, cpwNull: 0 };
    tallies.push(tally);

    // Shift the clock so the 90-day cutoff on closed issues/PRs reaches back
    // from the oldest gap date, not from today.
    Date.now = () => oldest - DAY_MS;
    const issues = await fetchIssues(client, owner, repo, false);
    const pulls = await fetchPullRequests(client, owner, repo, false);
    Date.now = () => realNow;
    // 12 weeks of commit history relative to the oldest gap date.
    const weeks = 12 + Math.ceil((realNow - oldest) / (7 * DAY_MS)) + 1;
    const { commits, totalCount } = await fetchCommits(client, owner, repo, weeks, false);
    // fetchCommits stops paginating at its cap. When it did, the oldest commit
    // fetched bounds which dates have a complete 12-week commit window.
    const commitsTruncated = commits.length < totalCount;
    const commitsFrom = commitsTruncated
      ? Math.min(...commits.map((c) => new Date(c.committedDate).getTime())) // Infinity if none came back
      : -Infinity;
    const truncation = !commitsTruncated ? ''
      : Number.isFinite(commitsFrom) ? ` (truncated; complete from ${new Date(commitsFrom).toISOString().split('T')[0]})`
      : ' (truncated; none fetched)';
    const stars = await fetchEventTimestamps(client, owner, repo, 'stargazers', oldest - DAY_MS);
    const forks = await fetchEventTimestamps(client, owner, repo, 'forks', oldest - DAY_MS);
    console.log(
      `  fetched ${issues.open.length + issues.closed.length} issues, ` +
      `${pulls.open.length + pulls.closed.length} PRs, ${commits.length}/${totalCount} commits${truncation}, ` +
      `${stars.recent.length} recent stars, ${forks.recent.length} recent forks`
    );

    const allIssues = [...issues.open, ...issues.closed];
    const allPRs = [...pulls.open, ...pulls.closed];
    const snapDir = join('data', 'repos', owner, repo, 'snapshots');
    await mkdir(snapDir, { recursive: true });

    // Real snapshots on either side of the gap, used to interpolate the
    // couple of fields that can't be rewound from timestamps.
    const beforeDate = shiftDate(from, -1);
    const afterDate = shiftDate(to, 1);
    const before = await readRealSnapshot(snapDir, beforeDate);
    const after = await readRealSnapshot(snapDir, afterDate);

    for (const date of gapDates) {
      const path = join(snapDir, `${date}.json`);
      const existing = await readSnapshot(snapDir, date);
      if (existing?.issues != null && !force) {
        console.log(`  ${date}: already has GitHub metrics, skipping (use --force to overwrite)`);
        tally.skipped++;
        continue;
      }

      const asOf = endOfDay(date);
      Date.now = () => asOf;
      const dayIssues = issuesAsOf(allIssues, asOf);
      const dayPulls = pullsAsOf(allPRs, asOf);
      const dayCommits: CommitData[] = commits.filter((c) => new Date(c.committedDate).getTime() <= asOf);
      const issueMetrics = calculateIssueMetrics(dayIssues, maintainerSet, owner, repo);
      const prMetrics = calculatePRMetrics(dayPulls, maintainerSet, owner, repo);
      const contributorMetrics = await calculateContributorMetrics(dayIssues, dayPulls, dayCommits, maintainerSet, repoConfig as RepoConfig);
      Date.now = () => realNow;

      // Keep whatever the file already holds (download stubs, actionability);
      // date leads and always matches the filename.
      const snapshot: ReconstructedSnapshot = { date, ...(existing ?? {}) };
      snapshot.date = date;

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
        // updatedAt and labels have no as-of history (see APPROX_FIELDS).
        stale_30d: null,
        stale_60d: null,
        stale_90d: null,
        reopen_rate: issueMetrics.reopen_rate,
        response_time: issueMetrics.response_time,
        close_time: issueMetrics.close_time,
        label_coverage_pct: null,
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
        // Draft state and size labels are today's, not as of T.
        draft_count: null,
        without_review_24h: prMetrics.without_review_24h,
        without_review_7d: prMetrics.without_review_7d,
        review_time: prMetrics.review_time,
        merge_time: prMetrics.merge_time,
        code_review_rate_pct: prMetrics.code_review_rate_pct,
        rejection_rate_pct: prMetrics.rejection_rate_pct,
        avg_reviews_per_pr: prMetrics.avg_reviews_per_pr,
        by_size: null,
      };
      snapshot.repository = {
        stars: countAsOf(stars.current, stars.recent, asOf),
        forks: countAsOf(forks.current, forks.recent, asOf),
      };
      // loadContributors() unions in today's all-time roster, so the raw total
      // is anachronistic; interpolate between the real neighbours or write null.
      const total = interpolate(before?.contributors?.total, after?.contributors?.total, beforeDate, afterDate, date) ?? null;
      // The 12-week commit window ending at T is complete unless the fetch
      // stopped after T - 12w; then the computed average undercounts.
      const cpwExact = commitsFrom <= asOf - COMMIT_WINDOW_MS;
      const cpw = cpwExact
        ? contributorMetrics.commits_per_week_avg
        : interpolate(before?.contributors?.commits_per_week_avg, after?.contributors?.commits_per_week_avg, beforeDate, afterDate, date, 1) ?? null;
      snapshot.contributors = {
        total,
        active_30d: contributorMetrics.active_30d,
        first_time_30d: contributorMetrics.first_time_30d,
        retention_rate_pct: contributorMetrics.retention_rate_pct,
        churned_30d: contributorMetrics.churned_30d,
        commits_per_week_avg: cpw,
        active_maintainers_30d: contributorMetrics.active_maintainers_30d,
        active_community_30d: contributorMetrics.active_community_30d,
      };
      snapshot.meta = {
        source: 'reconstructed',
        approx: cpwExact ? [...APPROX_FIELDS] : [...APPROX_FIELDS, 'contributors.commits_per_week_avg'],
      };

      await writeFile(path, JSON.stringify(snapshot, null, 2));
      tally.written++;
      if (!existing) tally.created++;
      if (total === null) tally.totalNull++;
      if (!cpwExact && cpw === null) tally.cpwNull++;
      else if (!cpwExact) tally.cpwInterpolated++;
      sample = snapshot;
      console.log(
        `  ${date}: issues.open=${issueMetrics.open_count} pulls.open=${prMetrics.open_count} ` +
        `stars=${snapshot.repository.stars} contributors.total=${total ?? 'null'} ` +
        `commits_per_week_avg=${cpw ?? 'null'}${cpwExact ? '' : ' (interpolated)'}${existing ? '' : ' [new file]'}`
      );
    }
  }

  printSummary(gapDates, tallies, sample);
}

/** Dates x repos x fields written, for reviewing a dry run before committing. */
function printSummary(gapDates: string[], tallies: RepoTally[], sample: ReconstructedSnapshot | undefined): void {
  const sum = (key: Exclude<keyof RepoTally, 'repo'>) => tallies.reduce((n, t) => n + t[key], 0);
  console.log(`\nSummary: ${gapDates.length} dates (${gapDates[0]}..${gapDates[gapDates.length - 1]}) x ${tallies.length} repos`);
  console.log(`  ${'repo'.padEnd(22)}${['written', 'new', 'skipped', 'total=null', 'cpw=interp', 'cpw=null'].map((h) => h.padStart(11)).join('')}`);
  for (const t of tallies) {
    const cells = [t.written, t.created, t.skipped, t.totalNull, t.cpwInterpolated, t.cpwNull];
    console.log(`  ${t.repo.padEnd(22)}${cells.map((n) => String(n).padStart(11)).join('')}`);
  }
  const totals = [sum('written'), sum('created'), sum('skipped'), sum('totalNull'), sum('cpwInterpolated'), sum('cpwNull')];
  console.log(`  ${'all'.padEnd(22)}${totals.map((n) => String(n).padStart(11)).join('')}`);
  if (!sample) {
    console.log('  nothing written');
    return;
  }
  console.log('  fields written on each date:');
  for (const block of ['issues', 'pulls', 'repository', 'contributors', 'meta'] as const) {
    const keys = Object.keys(sample[block] ?? {});
    console.log(`    ${block.padEnd(13)}(${keys.length}) ${keys.join(' ')}`);
  }
  console.log(`  always null: ${NULL_FIELDS.join(' ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
