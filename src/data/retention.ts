/**
 * Snapshot retention management
 *
 * Policy:
 * - Keep daily snapshots for 90 days
 * - Consolidate older snapshots to monthly
 */

import { readdir, readFile, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import type { DailySnapshot } from '../types/index.js';

const SNAPSHOTS_DIR = join(process.cwd(), 'data', 'snapshots');
const RETENTION_DAYS = 90;

/**
 * Parse date from snapshot filename (YYYY-MM-DD.json)
 */
function parseDateFromFilename(filename: string): Date | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
  if (!match) return null;
  return new Date(match[1]);
}

/**
 * Get month key from date (YYYY-MM)
 */
function getMonthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * Consolidate old daily snapshots into monthly snapshots
 */
export async function consolidateSnapshots(): Promise<void> {
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // Read all snapshot files
  let files: string[];
  try {
    files = await readdir(SNAPSHOTS_DIR);
  } catch {
    // Snapshots directory doesn't exist yet
    return;
  }

  // Group old snapshots by month
  const monthlyGroups = new Map<string, { snapshots: DailySnapshot[]; files: string[] }>();

  for (const filename of files) {
    // Skip monthly files (YYYY-MM-monthly.json)
    if (filename.includes('-monthly')) continue;

    const date = parseDateFromFilename(filename);
    if (!date) continue;

    // Only process files older than retention period
    if (date >= cutoffDate) continue;

    const monthKey = getMonthKey(date);
    const group = monthlyGroups.get(monthKey) || { snapshots: [], files: [] };

    try {
      const content = await readFile(join(SNAPSHOTS_DIR, filename), 'utf-8');
      const snapshot: DailySnapshot = JSON.parse(content);
      group.snapshots.push(snapshot);
      group.files.push(filename);
      monthlyGroups.set(monthKey, group);
    } catch {
      console.warn(`Warning: Failed to read snapshot ${filename}`);
    }
  }

  // Create monthly consolidated files and delete daily files
  for (const [monthKey, group] of monthlyGroups) {
    if (group.snapshots.length === 0) continue;

    // Calculate monthly averages
    const monthlySnapshot = consolidateMonthlyData(monthKey, group.snapshots);

    // Write monthly file
    const monthlyFilename = `${monthKey}-monthly.json`;
    await writeFile(
      join(SNAPSHOTS_DIR, monthlyFilename),
      JSON.stringify(monthlySnapshot, null, 2)
    );

    console.log(`  Created monthly snapshot: ${monthlyFilename} (from ${group.files.length} daily files)`);

    // Delete daily files
    for (const filename of group.files) {
      try {
        await unlink(join(SNAPSHOTS_DIR, filename));
      } catch {
        console.warn(`Warning: Failed to delete ${filename}`);
      }
    }
  }
}

/**
 * Consolidate multiple daily snapshots into a monthly summary
 */
function consolidateMonthlyData(monthKey: string, snapshots: DailySnapshot[]): DailySnapshot {
  // Use the last day of the month as the representative date
  const lastSnapshot = snapshots[snapshots.length - 1];

  // Calculate averages
  const avgIssuesOpen = Math.round(
    snapshots.reduce((sum, s) => sum + s.issues.open, 0) / snapshots.length
  );
  const avgIssuesClosed = Math.round(
    snapshots.reduce((sum, s) => sum + s.issues.closed_30d, 0) / snapshots.length
  );
  const avgResponseTime =
    snapshots.reduce((sum, s) => sum + s.issues.response_time_median_hours, 0) / snapshots.length;

  const avgPRsOpen = Math.round(
    snapshots.reduce((sum, s) => sum + s.pulls.open, 0) / snapshots.length
  );
  const avgPRsMerged = Math.round(
    snapshots.reduce((sum, s) => sum + s.pulls.merged_30d, 0) / snapshots.length
  );
  const avgReviewTime =
    snapshots.reduce((sum, s) => sum + s.pulls.review_time_median_hours, 0) / snapshots.length;

  // Use max for cumulative metrics
  const maxStars = Math.max(...snapshots.map((s) => s.repository.stars));
  const maxForks = Math.max(...snapshots.map((s) => s.repository.forks));
  const maxContributors = Math.max(...snapshots.map((s) => s.contributors.total));

  return {
    date: `${monthKey}-01`, // First day of month as representative
    issues: {
      open: avgIssuesOpen,
      closed_30d: avgIssuesClosed,
      response_time_median_hours: Math.round(avgResponseTime * 10) / 10,
    },
    pulls: {
      open: avgPRsOpen,
      merged_30d: avgPRsMerged,
      review_time_median_hours: Math.round(avgReviewTime * 10) / 10,
    },
    repository: {
      stars: maxStars,
      forks: maxForks,
    },
    contributors: {
      total: maxContributors,
      first_time_30d: lastSnapshot.contributors.first_time_30d, // Use last value
    },
  };
}
