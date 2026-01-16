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
import { calculateIssueMetrics } from './metrics/issues.js';
import { calculatePRMetrics } from './metrics/pulls.js';
import { calculateContributorMetrics } from './metrics/contributors.js';
import { calculateHotspots } from './metrics/hotspots.js';
import {
  writeMetrics,
  writeMaintainers,
  updateContributors,
  writeSnapshot,
  writeRepoIndex,
} from './data/writers.js';
import { loadConfig, createDefaultConfig } from './config/loader.js';
import type { Metrics, RepoConfig, ReposConfig } from './types/index.js';
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
  for (let i = 0; i < repoCount; i++) {
    const repoConfig = config.repositories[i];
    await aggregateRepository(client, repoConfig, maintainerSet, dryRun, verbose, i + 1, repoCount);
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
  totalRepos: number
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

  // Fetch commits
  const commitSpinner = spinner('Fetching commit history (12 weeks)').start();
  const commitsResult = await fetchCommits(client, owner, repo, 12, verbose);
  commitSpinner.succeed(`Commits: ${style.bold(String(commitsResult.commits.length))} in last 12 weeks`);

  // Compute metrics
  const metricsSpinner = spinner('Computing metrics').start();
  const issueMetrics = calculateIssueMetrics(issues, maintainerSet, owner, repo);
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
    await updateContributors(contributorMetrics.allContributors, repoConfig);
    await writeSnapshot(metrics, repoConfig);
    writeSpinner.succeed(`Data written to ${style.dim(repoPath + '/')}`);
  }
}
