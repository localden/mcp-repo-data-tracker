/**
 * Main aggregation orchestrator
 */

import type { CliArgs } from './cli.js';
import { createGitHubClient } from './github/client.js';
import { fetchMaintainers } from './github/maintainers.js';
import { fetchIssues } from './github/issues.js';
import { fetchPullRequests } from './github/pulls.js';
import { fetchHotspotData } from './github/hotspots.js';
import { fetchRepoStats } from './github/repo.js';
import { fetchCommits } from './github/commits.js';
import { fetchDownloads } from './downloads/index.js';
import { fetchPypiVersions, mergeVersionData, deriveDownloadMetrics } from './downloads/bigquery.js';
import { fetchPypiFirstPublished } from './downloads/pypi.js';
import { fetchNpmVersions } from './downloads/npm.js';
import { fetchNugetVersions } from './downloads/nuget.js';
import { calculateIssueMetrics } from './metrics/issues.js';
import { buildIssueTiers } from './metrics/issueTiers.js';
import { calculatePRMetrics } from './metrics/pulls.js';
import { calculateContributorMetrics } from './metrics/contributors.js';
import { calculateHotspots } from './metrics/hotspots.js';
import { calculateSEPMetrics } from './metrics/seps.js';
import {
  writeMetrics,
  writeIssueTiers,
  writeMaintainers,
  updateContributors,
  writeSnapshot,
  writeRepoIndex,
  writeSEPMetrics,
  loadRecentSnapshots,
  writeDownloadsSidecar,
  writeVersionDownloads,
  loadVersionDownloads,
} from './data/writers.js';
import { loadConfig, createDefaultConfig } from './config/loader.js';
import type { Metrics, RepoConfig, ReposConfig, DownloadMetrics, VersionDownloadsData } from './types/index.js';
import {
  spinner,
  header,
  subheader,
  success,
  warning,
  info,
  keyValue,
  style,
  divider,
  newline,
  formatNumber,
  box,
} from './cli/output.js';

export async function aggregate(args: CliArgs): Promise<void> {
  // Handle SEP-only mode
  if (args.sepOnly) {
    return aggregateSEPOnly(args);
  }

  // Handle single-slice modes (split workflow)
  if (args.only === 'downloads') return aggregateDownloadsOnly(args);
  if (args.only === 'bigquery') return aggregateBigQuery(args);
  // --only=github falls through to the normal path with skipDownloads=true

  const { dryRun, verbose, configPath } = args;
  const client = createGitHubClient();
  const startTime = Date.now();

  // Load configuration
  let config: ReposConfig;
  const configSpinner = spinner('Loading configuration').start();
  try {
    if (args.owner && args.repo) {
      configSpinner.warn('Using legacy CLI mode (consider using repos.json instead)');
      config = createDefaultConfig(args.owner, args.repo);
    } else {
      config = await loadConfig(configPath);
      configSpinner.succeed(`Loaded ${config.repositories.length} repositories from config`);
    }
  } catch (error) {
    if (!configPath && !args.owner && !args.repo) {
      configSpinner.warn('No repos.json found, using default configuration');
      config = createDefaultConfig('modelcontextprotocol', 'modelcontextprotocol');
    } else {
      configSpinner.fail('Failed to load configuration');
      throw error;
    }
  }

  if (dryRun) {
    newline();
    warning('Dry run mode — no files will be written');
  }

  // Step 1: Fetch maintainers (shared across repos)
  newline();
  const maintainerSpinner = spinner('Fetching maintainers').start();
  const maintainers = await fetchMaintainers(client, verbose);
  maintainerSpinner.succeed(`Found ${style.bold(String(maintainers.maintainers.length))} maintainers`);
  const maintainerSet = new Set(maintainers.maintainers.map((m) => m.github));

  // Process each repository
  const repoCount = config.repositories.length;
  const skipDownloads = args.only === 'github';
  let failed = 0;
  for (let i = 0; i < repoCount; i++) {
    const repoConfig = config.repositories[i];
    try {
      await aggregateRepository(client, repoConfig, maintainerSet, dryRun, verbose, i + 1, repoCount, skipDownloads);
    } catch (err) {
      failed++;
      warning(`Skipping ${repoConfig.owner}/${repoConfig.repo}: ${(err as Error).message}`);
    }
  }
  if (failed === repoCount) {
    throw new Error(`All ${repoCount} repositories failed to aggregate`);
  }

  // Write global files
  newline();
  if (dryRun) {
    info('Would write global files:');
    keyValue('maintainers', 'data/maintainers.json');
    keyValue('repositories', 'data/repos.json');
  } else {
    const writeSpinner = spinner('Writing global data files').start();
    await writeMaintainers(maintainers);
    await writeRepoIndex(config.repositories);
    writeSpinner.succeed('Global data files written');
  }

  // Summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  newline();
  divider();
  success(`Aggregation complete in ${style.bold(duration + 's')}`);
}

/**
 * Aggregate data for a single repository
 */
async function aggregateRepository(
  client: ReturnType<typeof createGitHubClient>,
  repoConfig: RepoConfig,
  maintainerSet: Set<string>,
  dryRun: boolean,
  verbose: boolean,
  repoIndex: number,
  totalRepos: number,
  skipDownloads = false
): Promise<void> {
  const { owner, repo } = repoConfig;
  const displayName = repoConfig.name || `${owner}/${repo}`;

  header(`[${repoIndex}/${totalRepos}] ${displayName}`);
  info(`${style.dim(`github.com/${owner}/${repo}`)}`);

  // Fetch issues
  const issueSpinner = spinner('Fetching issues').start();
  const issues = await fetchIssues(client, owner, repo, verbose);
  issueSpinner.succeed(`Issues: ${style.bold(String(issues.open.length))} open, ${style.dim(String(issues.closed.length) + ' closed')}`);

  // Fetch PRs
  const prSpinner = spinner('Fetching pull requests').start();
  const pulls = await fetchPullRequests(client, owner, repo, verbose);
  prSpinner.succeed(`PRs: ${style.bold(String(pulls.open.length))} open, ${style.dim(String(pulls.closed.length) + ' closed/merged')}`);

  // Fetch hotspot data
  const mergedPRs = pulls.closed.filter((pr) => pr.mergedAt !== null);
  const hotspotSpinner = spinner(`Analyzing ${mergedPRs.length} merged PRs for hotspots`).start();
  const hotspotData = await fetchHotspotData(client, owner, repo, mergedPRs, verbose);
  hotspotSpinner.succeed(`Hotspots: analyzed ${style.bold(String(mergedPRs.length))} merged PRs`);

  // Fetch repo stats
  const statsSpinner = spinner('Fetching repository stats').start();
  const repoStats = await fetchRepoStats(client, owner, repo);
  statsSpinner.succeed(`Stats: ${style.bold(formatNumber(repoStats.stars))} ⭐  ${style.bold(formatNumber(repoStats.forks))} forks`);

  // Fetch package downloads (if configured)
  let downloads: DownloadMetrics | undefined;
  if (repoConfig.package && !skipDownloads) {
    const dlSpinner = spinner(`Fetching ${repoConfig.package.registry} downloads`).start();
    try {
      const recent = await loadRecentSnapshots(repoConfig, 30);
      // Running-sum seed: use the most-recent snapshot that HAS a total, not
      // blindly yesterday's — a single lagged/failed day would otherwise break
      // the chain permanently.
      const prev = recent.find((s) => s.downloads?.total !== undefined) ?? recent[0];
      downloads = await fetchDownloads(repoConfig.package, prev);
      // Registries that don't report last_week/last_month natively: sum today + prior snapshots.
      if (downloads.last_week === undefined && downloads.daily !== undefined) {
        downloads.last_week = recent.slice(0, 6).reduce((s, snap) => s + (snap.downloads?.daily ?? 0), downloads.daily);
      }
      if (downloads.last_month === undefined && downloads.daily !== undefined) {
        downloads.last_month = recent.slice(0, 29).reduce((s, snap) => s + (snap.downloads?.daily ?? 0), downloads.daily);
      }
      const headline = downloads.daily !== undefined ? `${formatNumber(downloads.daily)}/day` : `${formatNumber(downloads.total ?? 0)} total`;
      dlSpinner.succeed(`Downloads: ${style.bold(headline)} (${repoConfig.package.registry})`);
    } catch (err) {
      dlSpinner.warn(`Download stats unavailable: ${(err as Error).message}`);
    }
  }

  // Fetch commits
  const commitSpinner = spinner('Fetching commit history (12 weeks)').start();
  const commitsResult = await fetchCommits(client, owner, repo, 12, verbose);
  commitSpinner.succeed(`Commits: ${style.bold(String(commitsResult.commits.length))} in last 12 weeks`);

  // Compute metrics
  const metricsSpinner = spinner('Computing metrics').start();
  const issueMetrics = calculateIssueMetrics(issues, maintainerSet, owner, repo);
  // Tier dashboard is SDK-only — spec repo uses labels differently, csharp isn't actively triaged yet.
  const TIER_REPOS = new Set(['typescript-sdk', 'python-sdk']);
  const issueTiers = TIER_REPOS.has(repo) ? buildIssueTiers(issues.open, maintainerSet, owner, repo) : null;
  const prMetrics = calculatePRMetrics(pulls, maintainerSet, owner, repo);
  const contributorMetrics = await calculateContributorMetrics(issues, pulls, commitsResult.commits, maintainerSet, repoConfig);
  const hotspots = calculateHotspots(hotspotData);
  metricsSpinner.succeed('Metrics computed');

  const metrics: Metrics = {
    timestamp: new Date().toISOString(),
    repository: repoStats,
    issues: issueMetrics,
    pulls: prMetrics,
    contributors: contributorMetrics,
    hotspots,
    ...(downloads && { downloads }),
  };

  // Write data files
  const repoPath = `data/repos/${owner}/${repo}`;
  if (dryRun) {
    newline();
    info('Would write files:');
    keyValue('metrics', `${repoPath}/metrics.json`);
    keyValue('contributors', `${repoPath}/contributors.json`);
    keyValue('snapshot', `${repoPath}/snapshots/${new Date().toISOString().split('T')[0]}.json`);

    if (verbose) {
      newline();
      subheader('Metrics Preview');
      box('Summary', [
        `Open Issues: ${issueMetrics.open_count}`,
        `Open PRs: ${prMetrics.open_count}`,
        `Active Contributors (30d): ${contributorMetrics.active_30d}`,
        `  ├─ Maintainers: ${contributorMetrics.active_maintainers_30d}`,
        `  └─ Community: ${contributorMetrics.active_community_30d}`,
        `Issues needing attention: ${issueMetrics.issues_without_maintainer_response.length}`,
        `PRs needing review: ${prMetrics.prs_without_maintainer_review.length}`,
      ]);
    }
  } else {
    const writeSpinner = spinner('Writing data files').start();
    await writeMetrics(metrics, repoConfig);
    if (issueTiers) await writeIssueTiers(issueTiers, repoConfig);
    await updateContributors(contributorMetrics.allContributors, repoConfig);
    await writeSnapshot(metrics, repoConfig);
    writeSpinner.succeed(`Data written to ${style.dim(repoPath + '/')}`);
  }

  // SEP metrics (only for modelcontextprotocol/modelcontextprotocol)
  if (owner === 'modelcontextprotocol' && repo === 'modelcontextprotocol') {
    const sepSpinner = spinner('Computing SEP metrics').start();
    const sepMetrics = calculateSEPMetrics(pulls, owner, repo, maintainerSet);
    sepSpinner.succeed(`SEPs: ${style.bold(String(sepMetrics.counts.total))} total (${sepMetrics.counts.proposal} proposals, ${sepMetrics.counts.draft} drafts, ${sepMetrics.counts.inReview} in-review, ${sepMetrics.counts.accepted} accepted, ${sepMetrics.counts.merged} merged)`);

    if (dryRun) {
      keyValue('seps', `${repoPath}/seps.json`);
    } else {
      const sepWriteSpinner = spinner('Writing SEP data').start();
      await writeSEPMetrics(sepMetrics, repoConfig);
      sepWriteSpinner.succeed(`SEP data written to ${style.dim(repoPath + '/seps.json')}`);
    }
  }
}

/**
 * SEP-only aggregation mode
 * Only fetches PRs and computes SEP metrics for modelcontextprotocol/modelcontextprotocol
 */
async function aggregateSEPOnly(args: CliArgs): Promise<void> {
  const { dryRun, verbose } = args;
  const client = createGitHubClient();
  const startTime = Date.now();

  const owner = 'modelcontextprotocol';
  const repo = 'modelcontextprotocol';
  const repoConfig: RepoConfig = { owner, repo, name: 'MCP Specification' };

  header('SEP-Only Aggregation');
  info(`${style.dim(`github.com/${owner}/${repo}`)}`);

  if (dryRun) {
    newline();
    warning('Dry run mode — no files will be written');
  }

  // Fetch maintainers (needed to classify "final" SEPs)
  newline();
  const maintainerSpinner = spinner('Fetching maintainers').start();
  const maintainers = await fetchMaintainers(client, verbose);
  maintainerSpinner.succeed(`Found ${style.bold(String(maintainers.maintainers.length))} maintainers`);
  const maintainerSet = new Set(maintainers.maintainers.map((m) => m.github));

  // Fetch PRs (only data needed for SEPs)
  const prSpinner = spinner('Fetching pull requests').start();
  const pulls = await fetchPullRequests(client, owner, repo, verbose);
  prSpinner.succeed(`PRs: ${style.bold(String(pulls.open.length))} open, ${style.dim(String(pulls.closed.length) + ' closed/merged')}`);

  // Compute SEP metrics
  const sepSpinner = spinner('Computing SEP metrics').start();
  const sepMetrics = calculateSEPMetrics(pulls, owner, repo, maintainerSet);
  sepSpinner.succeed(`SEPs: ${style.bold(String(sepMetrics.counts.total))} total (${sepMetrics.counts.proposal} proposals, ${sepMetrics.counts.draft} drafts, ${sepMetrics.counts.inReview} in-review, ${sepMetrics.counts.accepted} accepted, ${sepMetrics.counts.merged} merged)`);

  // Write SEP data
  const repoPath = `data/repos/${owner}/${repo}`;
  if (dryRun) {
    newline();
    info('Would write files:');
    keyValue('seps', `${repoPath}/seps.json`);
  } else {
    const writeSpinner = spinner('Writing SEP data').start();
    await writeSEPMetrics(sepMetrics, repoConfig);
    writeSpinner.succeed(`SEP data written to ${style.dim(repoPath + '/seps.json')}`);
  }

  // Summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  newline();
  divider();
  success(`SEP aggregation complete in ${style.bold(duration + 's')}`);
}

/**
 * Downloads-only mode (--only=downloads).
 * Writes a downloads.json sidecar per package-bearing repo; the commit job
 * jq-patches it into metrics.json and today's snapshot.
 */
async function aggregateDownloadsOnly(args: CliArgs): Promise<void> {
  const { dryRun, configPath, registry } = args;
  const startTime = Date.now();

  const config = await loadConfig(configPath);
  header(`Downloads-Only Aggregation${registry ? ` (${registry})` : ''}`);

  let failed = false;
  for (const repoConfig of config.repositories) {
    if (!repoConfig.package) continue;
    // PyPI is sourced from BigQuery (--only=bigquery); skip it here so we
    // have a single source of truth.
    if (repoConfig.package.registry === 'pypi') continue;
    if (registry && repoConfig.package.registry !== registry) continue;
    const dlSpinner = spinner(`${repoConfig.owner}/${repoConfig.repo} (${repoConfig.package.registry})`).start();
    try {
      const recent = await loadRecentSnapshots(repoConfig, 30);
      const prev = recent.find((s) => s.downloads?.total !== undefined) ?? recent[0];
      const downloads = await fetchDownloads(repoConfig.package, prev);
      if (downloads.last_week === undefined && downloads.daily !== undefined) {
        downloads.last_week = recent.slice(0, 6).reduce((s, snap) => s + (snap.downloads?.daily ?? 0), downloads.daily);
      }
      if (downloads.last_month === undefined && downloads.daily !== undefined) {
        downloads.last_month = recent.slice(0, 29).reduce((s, snap) => s + (snap.downloads?.daily ?? 0), downloads.daily);
      }
      if (!dryRun) await writeDownloadsSidecar(downloads, repoConfig);

      // Per-version snapshot: npm/nuget don't expose daily history, so we
      // build our own by storing today's API response in versions.json.
      const byVersion = repoConfig.package.registry === 'npm'
        ? await fetchNpmVersions(repoConfig.package.name)
        : repoConfig.package.registry === 'nuget'
          ? await fetchNugetVersions(repoConfig.package.name)
          : null;
      if (byVersion) {
        const existing = await loadVersionDownloads(repoConfig);
        const today = new Date().toISOString().split('T')[0];
        const unit = repoConfig.package.registry === 'npm' ? 'last_week' : 'cumulative';
        const merged: VersionDownloadsData = {
          lastUpdated: new Date().toISOString(),
          unit,
          daily: { ...existing?.daily, [today]: byVersion },
          // For non-daily units the latest snapshot IS the totals — summing
          // across dates would double-count overlapping windows.
          totals: byVersion,
        };
        if (!dryRun) await writeVersionDownloads(merged, repoConfig);
      }

      const headline = downloads.daily !== undefined ? `${formatNumber(downloads.daily)}/day` : `${formatNumber(downloads.total ?? 0)} total`;
      const vCount = byVersion ? `, ${Object.keys(byVersion).length} versions` : '';
      dlSpinner.succeed(`${repoConfig.package.name}: ${headline}${vCount}`);
    } catch (err) {
      dlSpinner.fail(`${repoConfig.package.name}: ${(err as Error).message}`);
      failed = true;
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  newline();
  // With --registry the job covers one ecosystem; a failure should surface
  // as a red subjob rather than being swallowed.
  if (failed && registry) throw new Error(`${registry} download fetch failed`);
  success(`Downloads aggregation complete in ${style.bold(duration + 's')}`);
}

/**
 * BigQuery mode (--only=bigquery).
 * Queries bigquery-public-data.pypi.file_downloads for per-version daily
 * counts since the last stored date, merges into versions.json.
 */
async function aggregateBigQuery(args: CliArgs): Promise<void> {
  const { dryRun, configPath } = args;
  const startTime = Date.now();

  const config = await loadConfig(configPath);
  header('BigQuery PyPI Aggregation');

  for (const repoConfig of config.repositories) {
    if (repoConfig.package?.registry !== 'pypi') continue;
    const pkg = repoConfig.package.name;
    const bqSpinner = spinner(`${pkg}: querying BigQuery`).start();
    try {
      const existing = await loadVersionDownloads(repoConfig);
      // Incremental: re-query from the last stored date (not +1) so partial
      // intra-day data gets refreshed on the next 2h run. First run bootstraps
      // from the package's first-published date so the total reflects full
      // lifetime downloads.
      const dates = existing ? Object.keys(existing.daily).sort() : [];
      const since = dates.length > 0
        ? dates[dates.length - 1]
        : await fetchPypiFirstPublished(pkg);

      const fresh = await fetchPypiVersions(pkg, since);
      const merged = mergeVersionData(existing, fresh);
      const aggregate = deriveDownloadMetrics(merged);

      if (!dryRun) {
        await writeVersionDownloads(merged, repoConfig);
        await writeDownloadsSidecar(aggregate, repoConfig);
      }
      const nDays = Object.keys(fresh.daily).length;
      const nVersions = Object.keys(merged.totals).length;
      bqSpinner.succeed(`${pkg}: ${formatNumber(aggregate.daily ?? 0)}/day, ${nVersions} version(s), ${nDays} day(s) refreshed`);
    } catch (err) {
      bqSpinner.fail(`${pkg}: ${(err as Error).message}`);
      throw err;
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  newline();
  success(`BigQuery aggregation complete in ${style.bold(duration + 's')}`);
}
