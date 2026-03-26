/**
 * Package download metrics dispatcher.
 * Registry quirks:
 *   - npm/PyPI report daily natively; NuGet only cumulative → daily derived from prev-snapshot diff.
 *   - npm cumulative isn't an API field; we carry a running sum forward from the previous snapshot
 *     (seeded by the backfill script's full-range sum).
 */

import type { PackageConfig, DownloadMetrics, DailySnapshot } from '../types/index.js';
import { fetchNpmDaily, fetchNpmRange } from './npm.js';
import { fetchPypiRecent } from './pypi.js';
import { fetchNugetTotal } from './nuget.js';

const DAY_MS = 86400000;

function addDays(date: string, n: number): string {
  return new Date(new Date(date).getTime() + n * DAY_MS).toISOString().split('T')[0];
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / DAY_MS);
}

export async function fetchDownloads(
  config: PackageConfig,
  prevSnapshot?: DailySnapshot
): Promise<DownloadMetrics> {
  const prev = prevSnapshot?.downloads;
  const prevDate = prevSnapshot?.date;
  const today = new Date().toISOString().split('T')[0];

  switch (config.registry) {
    case 'npm': {
      // Use the range API keyed by date so we never re-add days already in prev
      // (the /point/last-day/ endpoint lags and the backfill already stored
      // that day under its own date → running-sum double-count).
      if (prevDate && prev?.total !== undefined) {
        const range = await fetchNpmRange(config.name, addDays(prevDate, 1), today);
        const delta = [...range.values()].reduce((a, b) => a + b, 0);
        const dates = [...range.keys()].sort();
        const daily = dates.length ? range.get(dates[dates.length - 1]) : undefined;
        return { daily, total: prev.total + delta };
      }
      return { daily: await fetchNpmDaily(config.name) };
    }

    case 'pypi': {
      const recent = await fetchPypiRecent(config.name);
      const total = prev?.total !== undefined ? prev.total + recent.daily : undefined;
      return { ...recent, total };
    }

    case 'nuget': {
      const total = await fetchNugetTotal(config.name);
      if (prev?.total === undefined || !prevDate) return { total };
      const gap = daysBetween(prevDate, today);
      const delta = Math.max(0, total - prev.total);
      // Gaps > 1 day mean the diff spans multiple days — report per-day average
      // so the daily chart doesn't spike.
      return { daily: gap > 0 ? Math.round(delta / gap) : undefined, total };
    }
  }
}
