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
  const len = snapshots.length;

  // Helper for averaging with fallback to 0 for missing fields
  const avg = (getter: (s: DailySnapshot) => number | undefined): number =>
    Math.round(snapshots.reduce((sum, s) => sum + (getter(s) ?? 0), 0) / len);

  const avgFloat = (getter: (s: DailySnapshot) => number | undefined): number =>
    Math.round((snapshots.reduce((sum, s) => sum + (getter(s) ?? 0), 0) / len) * 10) / 10;

  // Use max for cumulative metrics
  const maxStars = Math.max(...snapshots.map((s) => s.repository.stars));
  const maxForks = Math.max(...snapshots.map((s) => s.repository.forks));
  const maxContributors = Math.max(...snapshots.map((s) => s.contributors.total));

  return {
    date: `${monthKey}-01`, // First day of month as representative
    issues: {
      open: avg((s) => s.issues.open),
      closed_7d: avg((s) => s.issues.closed_7d),
      closed_30d: avg((s) => s.issues.closed_30d),
      closed_90d: avg((s) => s.issues.closed_90d),
      opened_7d: avg((s) => s.issues.opened_7d),
      opened_30d: avg((s) => s.issues.opened_30d),
      opened_90d: avg((s) => s.issues.opened_90d),
      without_response_24h: avg((s) => s.issues.without_response_24h),
      without_response_7d: avg((s) => s.issues.without_response_7d),
      without_response_30d: avg((s) => s.issues.without_response_30d),
      stale_30d: avg((s) => s.issues.stale_30d),
      stale_60d: avg((s) => s.issues.stale_60d),
      stale_90d: avg((s) => s.issues.stale_90d),
      reopen_rate: avgFloat((s) => s.issues.reopen_rate),
      response_time: {
        avg_hours: avgFloat((s) => s.issues.response_time?.avg_hours),
        median_hours: avgFloat((s) => s.issues.response_time?.median_hours),
        p90_hours: avgFloat((s) => s.issues.response_time?.p90_hours),
        p95_hours: avgFloat((s) => s.issues.response_time?.p95_hours),
      },
    },
    pulls: {
      open: avg((s) => s.pulls.open),
      merged_7d: avg((s) => s.pulls.merged_7d),
      merged_30d: avg((s) => s.pulls.merged_30d),
      merged_90d: avg((s) => s.pulls.merged_90d),
      opened_7d: avg((s) => s.pulls.opened_7d),
      opened_30d: avg((s) => s.pulls.opened_30d),
      opened_90d: avg((s) => s.pulls.opened_90d),
      closed_not_merged_90d: avg((s) => s.pulls.closed_not_merged_90d),
      draft_count: avg((s) => s.pulls.draft_count),
      without_review_24h: avg((s) => s.pulls.without_review_24h),
      without_review_7d: avg((s) => s.pulls.without_review_7d),
      review_time: {
        avg_hours: avgFloat((s) => s.pulls.review_time?.avg_hours),
        median_hours: avgFloat((s) => s.pulls.review_time?.median_hours),
        p90_hours: avgFloat((s) => s.pulls.review_time?.p90_hours),
        p95_hours: avgFloat((s) => s.pulls.review_time?.p95_hours),
      },
      merge_time: {
        avg_hours: avgFloat((s) => s.pulls.merge_time?.avg_hours),
        median_hours: avgFloat((s) => s.pulls.merge_time?.median_hours),
      },
      by_size: {
        small: avg((s) => s.pulls.by_size?.small),
        medium: avg((s) => s.pulls.by_size?.medium),
        large: avg((s) => s.pulls.by_size?.large),
      },
    },
    repository: {
      stars: maxStars,
      forks: maxForks,
    },
    contributors: {
      total: maxContributors,
      active_30d: avg((s) => s.contributors.active_30d),
      first_time_30d: lastSnapshot.contributors.first_time_30d, // Use last value
    },
  };
}
