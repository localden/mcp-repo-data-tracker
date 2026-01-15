/**
 * Data file writers
 */

import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import type {
  Metrics,
  MaintainersData,
  ContributorsData,
  DailySnapshot,
  RepoConfig,
} from '../types/index.js';

const DATA_DIR = 'data';

/**
 * Get the data directory for a specific repository
 * Structure: data/repos/<owner>/<repo>/
 */
function getRepoDataDir(repoConfig?: RepoConfig): string {
  if (repoConfig) {
    return join(DATA_DIR, 'repos', repoConfig.owner, repoConfig.repo);
  }
  return DATA_DIR;
}

/**
 * Get the snapshots directory for a specific repository
 */
function getSnapshotsDir(repoConfig?: RepoConfig): string {
  return join(getRepoDataDir(repoConfig), 'snapshots');
}

/**
 * Ensure directory exists
 */
async function ensureDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // Directory already exists
  }
}

/**
 * Write metrics.json for a repository
 */
export async function writeMetrics(metrics: Metrics, repoConfig?: RepoConfig): Promise<void> {
  const dataDir = getRepoDataDir(repoConfig);
  const filePath = join(process.cwd(), dataDir, 'metrics.json');
  await ensureDir(dirname(filePath));
  await writeFile(filePath, JSON.stringify(metrics, null, 2));
}

/**
 * Write maintainers.json (global, not per-repo)
 */
export async function writeMaintainers(maintainers: MaintainersData): Promise<void> {
  const filePath = join(process.cwd(), DATA_DIR, 'maintainers.json');
  await ensureDir(dirname(filePath));
  await writeFile(filePath, JSON.stringify(maintainers, null, 2));
}

/**
 * Update contributors.json for a repository (append-only merge)
 */
export async function updateContributors(allContributors: string[], repoConfig?: RepoConfig): Promise<void> {
  const dataDir = getRepoDataDir(repoConfig);
  const filePath = join(process.cwd(), dataDir, 'contributors.json');
  await ensureDir(dirname(filePath));

  // Load existing contributors
  let existing: string[] = [];
  try {
    const content = await readFile(filePath, 'utf-8');
    const data: ContributorsData = JSON.parse(content);
    existing = data.contributors;
  } catch {
    // File doesn't exist - start fresh
  }

  // Merge and dedupe
  const merged = [...new Set([...existing, ...allContributors])].sort();

  const data: ContributorsData = {
    lastUpdated: new Date().toISOString(),
    contributors: merged,
  };

  await writeFile(filePath, JSON.stringify(data, null, 2));
}

/**
 * Write daily snapshot for a repository
 */
export async function writeSnapshot(metrics: Metrics, repoConfig?: RepoConfig): Promise<void> {
  const snapshotsDir = getSnapshotsDir(repoConfig);
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const filePath = join(process.cwd(), snapshotsDir, `${date}.json`);
  await ensureDir(dirname(filePath));

  const snapshot: DailySnapshot = {
    date,
    issues: {
      open: metrics.issues.open_count,
      closed_30d: metrics.issues.closed_30d,
      response_time_median_hours: metrics.issues.response_time.median_hours,
    },
    pulls: {
      open: metrics.pulls.open_count,
      merged_30d: metrics.pulls.merged_30d,
      review_time_median_hours: metrics.pulls.review_time.median_hours,
    },
    repository: metrics.repository,
    contributors: {
      total: metrics.contributors.total_known,
      first_time_30d: metrics.contributors.first_time_30d,
    },
  };

  await writeFile(filePath, JSON.stringify(snapshot, null, 2));
}

/**
 * Write repository index file listing all configured repos
 */
export async function writeRepoIndex(repos: RepoConfig[]): Promise<void> {
  const filePath = join(process.cwd(), DATA_DIR, 'repos.json');
  await ensureDir(dirname(filePath));

  const data = {
    lastUpdated: new Date().toISOString(),
    repositories: repos.map(r => ({
      owner: r.owner,
      repo: r.repo,
      name: r.name || `${r.owner}/${r.repo}`,
      description: r.description || '',
    })),
  };

  await writeFile(filePath, JSON.stringify(data, null, 2));
}

/**
 * Load existing contributors for a repository
 */
export async function loadContributors(repoConfig?: RepoConfig): Promise<string[]> {
  const dataDir = getRepoDataDir(repoConfig);
  const filePath = join(process.cwd(), dataDir, 'contributors.json');

  try {
    const content = await readFile(filePath, 'utf-8');
    const data: ContributorsData = JSON.parse(content);
    return data.contributors;
  } catch {
    return [];
  }
}
