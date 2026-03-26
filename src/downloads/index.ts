/**
 * Package download metrics dispatcher.
 * Registry quirks:
 *   - npm/PyPI report daily natively; NuGet only cumulative → daily derived from prev-snapshot diff.
 *   - npm cumulative isn't an API field; we carry a running sum forward from the previous snapshot
 *     (seeded by the backfill script's full-range sum).
 */

import type { PackageConfig, DownloadMetrics, DailySnapshot } from '../types/index.js';
import { fetchNpmDaily, fetchNpmRange } from './npm.js';
import { fetchPypiRecent, fetchPypiRange } from './pypi.js';
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
        // npm lags ~1-2 days; trailing zeros mean "not posted yet", not zero
        // downloads. Report the most recent nonzero day so the chart doesn't
        // cliff-dive while we wait for the API to catch up.
        const dates = [...range.keys()].sort();
        let daily: number | undefined;
        for (let i = dates.length - 1; i >= 0; i--) {
          const v = range.get(dates[i]);
          if (v && v > 0) { daily = v; break; }
        }
        return { daily, total: prev.total + delta };
      }
      return { daily: await fetchNpmDaily(config.name) };
    }

    case 'pypi': {
      // Same date-semantics issue as npm: /recent returns a past day's count
      // but we'd store it under the run date. Use /overall (per-date history)
      // so we only add days not already in prev.
      const recent = await fetchPypiRecent(config.name);
      if (prevDate && prev?.total !== undefined) {
        const range = await fetchPypiRange(config.name);
        const dates = [...range.keys()].filter((d) => d > prevDate).sort();
        const delta = dates.reduce((s, d) => s + (range.get(d) ?? 0), 0);
        let daily: number | undefined;
        for (let i = dates.length - 1; i >= 0; i--) {
          const v = range.get(dates[i]);
          if (v && v > 0) { daily = v; break; }
        }
        return { daily, last_week: recent.last_week, last_month: recent.last_month, total: prev.total + delta };
      }
      return recent;
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
