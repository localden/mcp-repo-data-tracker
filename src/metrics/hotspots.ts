/**
 * Calculate hotspot metrics from PR file data
 */

import type { HotspotRawData, HotspotMetrics, FileHotspot, DirectoryHotspot } from '../types/index.js';

const TOP_FILES = 20;
const TOP_DIRECTORIES = 10;

/**
 * Get the parent directory of a file path
 */
function getDirectory(filePath: string): string {
  const parts = filePath.split('/');
  if (parts.length <= 1) return '/';
  return parts.slice(0, -1).join('/') + '/';
}

/**
 * Calculate hotspot metrics from raw PR file data
 */
export function calculateHotspots(data: HotspotRawData[]): HotspotMetrics {
  // Aggregate by file
  const fileStats = new Map<string, { prCount: number; totalChanges: number }>();

  for (const prData of data) {
    const filesInPR = new Set<string>();

    for (const file of prData.files) {
      // Track unique files per PR
      if (!filesInPR.has(file.filename)) {
        filesInPR.add(file.filename);

        const existing = fileStats.get(file.filename) || { prCount: 0, totalChanges: 0 };
        existing.prCount++;
        existing.totalChanges += file.changes;
        fileStats.set(file.filename, existing);
      }
    }
  }

  // Convert to array and sort by PR count
  const by_file: FileHotspot[] = Array.from(fileStats.entries())
    .map(([path, stats]) => ({
      path,
      pr_count: stats.prCount,
      total_changes: stats.totalChanges,
    }))
    .sort((a, b) => b.pr_count - a.pr_count)
    .slice(0, TOP_FILES);

  // Aggregate by directory
  const dirStats = new Map<string, { prNumbers: Set<number>; files: Set<string> }>();

  for (const prData of data) {
    for (const file of prData.files) {
      const dir = getDirectory(file.filename);

      const existing = dirStats.get(dir) || { prNumbers: new Set(), files: new Set() };
      existing.prNumbers.add(prData.prNumber);
      existing.files.add(file.filename);
      dirStats.set(dir, existing);
    }
  }

  // Convert to array and sort by PR count
  const by_directory: DirectoryHotspot[] = Array.from(dirStats.entries())
    .map(([path, stats]) => ({
      path,
      pr_count: stats.prNumbers.size,
      file_count: stats.files.size,
    }))
    .sort((a, b) => b.pr_count - a.pr_count)
    .slice(0, TOP_DIRECTORIES);

  return {
    by_file,
    by_directory,
    top_n: TOP_FILES,
  };
}
