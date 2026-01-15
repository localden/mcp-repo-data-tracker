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
} from '../types/index.js';

const DATA_DIR = 'data';
const SNAPSHOTS_DIR = join(DATA_DIR, 'snapshots');

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
 * Write metrics.json
 */
export async function writeMetrics(metrics: Metrics): Promise<void> {
  const filePath = join(process.cwd(), DATA_DIR, 'metrics.json');
  await ensureDir(dirname(filePath));
  await writeFile(filePath, JSON.stringify(metrics, null, 2));
}

/**
 * Write maintainers.json
 */
export async function writeMaintainers(maintainers: MaintainersData): Promise<void> {
  const filePath = join(process.cwd(), DATA_DIR, 'maintainers.json');
  await ensureDir(dirname(filePath));
  await writeFile(filePath, JSON.stringify(maintainers, null, 2));
}

/**
 * Update contributors.json (append-only merge)
 */
export async function updateContributors(allContributors: string[]): Promise<void> {
  const filePath = join(process.cwd(), DATA_DIR, 'contributors.json');
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
 * Write daily snapshot
 */
export async function writeSnapshot(metrics: Metrics): Promise<void> {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const filePath = join(process.cwd(), SNAPSHOTS_DIR, `${date}.json`);
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
