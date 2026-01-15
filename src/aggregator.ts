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

export async function aggregate(args: CliArgs): Promise<void> {
  const { dryRun, verbose, configPath } = args;
  const client = createGitHubClient();

  // Load configuration
  let config: ReposConfig;
  try {
    if (args.owner && args.repo) {
      // Legacy mode: single repo from CLI args
      console.log('Using legacy CLI mode (consider using repos.json instead)');
      config = createDefaultConfig(args.owner, args.repo);
    } else {
      config = await loadConfig(configPath);
    }
  } catch (error) {
    // Fallback to legacy defaults if no config file
    if (!configPath && !args.owner && !args.repo) {
      console.log('No repos.json found, using default configuration');
      config = createDefaultConfig('modelcontextprotocol', 'modelcontextprotocol');
    } else {
      throw error;
    }
  }

  console.log(`Processing ${config.repositories.length} repository(ies)\n`);

  // Step 1: Fetch maintainers (shared across repos)
  console.log('Fetching maintainers...');
  const maintainers = await fetchMaintainers(client, verbose);
  console.log(`  Found ${maintainers.maintainers.length} maintainers`);
  const maintainerSet = new Set(maintainers.maintainers.map((m) => m.github));

  // Process each repository
  for (const repoConfig of config.repositories) {
    await aggregateRepository(client, repoConfig, maintainerSet, dryRun, verbose);
  }

  // Write global files
  if (dryRun) {
    console.log('\nDry run - would write:');
    console.log('  - data/maintainers.json');
    console.log('  - data/repos.json');
  } else {
    console.log('\nWriting global data files...');
    await writeMaintainers(maintainers);
    await writeRepoIndex(config.repositories);
    console.log('  Global data files written successfully');
  }
}

/**
 * Aggregate data for a single repository
 */
async function aggregateRepository(
  client: ReturnType<typeof createGitHubClient>,
  repoConfig: RepoConfig,
  maintainerSet: Set<string>,
  dryRun: boolean,
  verbose: boolean
): Promise<void> {
  const { owner, repo } = repoConfig;
  const displayName = repoConfig.name || `${owner}/${repo}`;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Repository: ${displayName} (${owner}/${repo})`);
  console.log(`${'='.repeat(60)}`);

  // Step 2: Fetch issues
  console.log('Fetching issues...');
  const issues = await fetchIssues(client, owner, repo, verbose);
  console.log(`  Found ${issues.open.length} open, ${issues.closed.length} recently closed`);

  // Step 3: Fetch PRs
  console.log('Fetching pull requests...');
  const pulls = await fetchPullRequests(client, owner, repo, verbose);
  console.log(`  Found ${pulls.open.length} open, ${pulls.closed.length} recently closed/merged`);

  // Step 4: Fetch hotspot data for merged PRs
  console.log('Fetching hotspot data...');
  const mergedPRs = pulls.closed.filter((pr) => pr.mergedAt !== null);
  const hotspotData = await fetchHotspotData(client, owner, repo, mergedPRs, verbose);
  console.log(`  Analyzed ${mergedPRs.length} merged PRs`);

  // Step 5: Fetch repo stats
  console.log('Fetching repository stats...');
  const repoStats = await fetchRepoStats(client, owner, repo);
  console.log(`  Stars: ${repoStats.stars}, Forks: ${repoStats.forks}`);

  // Step 6: Compute metrics
  console.log('Computing metrics...');

  const issueMetrics = calculateIssueMetrics(issues, maintainerSet);
  const prMetrics = calculatePRMetrics(pulls, maintainerSet);
  const contributorMetrics = await calculateContributorMetrics(issues, pulls, repoConfig);
  const hotspots = calculateHotspots(hotspotData);

  const metrics: Metrics = {
    timestamp: new Date().toISOString(),
    repository: repoStats,
    issues: issueMetrics,
    pulls: prMetrics,
    contributors: contributorMetrics,
    hotspots,
  };

  // Step 7: Write data files
  const repoPath = `data/repos/${owner}/${repo}`;
  if (dryRun) {
    console.log('\nDry run - would write:');
    console.log(`  - ${repoPath}/metrics.json`);
    console.log(`  - ${repoPath}/contributors.json`);
    console.log(`  - ${repoPath}/snapshots/${new Date().toISOString().split('T')[0]}.json`);
    console.log('\nMetrics preview:');
    console.log(JSON.stringify(metrics, null, 2));
  } else {
    console.log('Writing data files...');
    await writeMetrics(metrics, repoConfig);
    await updateContributors(contributorMetrics.allContributors, repoConfig);
    await writeSnapshot(metrics, repoConfig);
    console.log(`  Data files written to ${repoPath}/`);
  }
}
