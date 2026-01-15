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
import { writeMetrics, writeMaintainers, updateContributors, writeSnapshot } from './data/writers.js';
import type { Metrics, MaintainersData } from './types/index.js';

export async function aggregate(args: CliArgs): Promise<void> {
  const { owner, repo, dryRun, verbose } = args;
  const client = createGitHubClient();

  // Step 1: Fetch maintainers
  console.log('Fetching maintainers...');
  const maintainers = await fetchMaintainers(client, verbose);
  console.log(`  Found ${maintainers.maintainers.length} maintainers`);

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
  const maintainerSet = new Set(maintainers.maintainers.map((m) => m.github));

  const issueMetrics = calculateIssueMetrics(issues, maintainerSet);
  const prMetrics = calculatePRMetrics(pulls, maintainerSet);
  const contributorMetrics = await calculateContributorMetrics(issues, pulls);
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
  if (dryRun) {
    console.log('\nDry run - would write:');
    console.log('  - data/metrics.json');
    console.log('  - data/maintainers.json');
    console.log('  - data/contributors.json');
    console.log(`  - data/snapshots/${new Date().toISOString().split('T')[0]}.json`);
    console.log('\nMetrics preview:');
    console.log(JSON.stringify(metrics, null, 2));
  } else {
    console.log('Writing data files...');
    await writeMetrics(metrics);
    await writeMaintainers(maintainers);
    await updateContributors(contributorMetrics.allContributors);
    await writeSnapshot(metrics);
    console.log('  Data files written successfully');
  }
}
