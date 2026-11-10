/**
 * Package download metrics dispatcher.
 * Registry quirks:
 *   - npm/PyPI/crates.io report daily natively; NuGet/RubyGems only cumulative → daily derived
 *     from prev-snapshot diff.
 *   - npm cumulative isn't an API field; we carry a running sum forward from the previous snapshot
 *     (seeded by the backfill script's full-range sum).
 *   - crates.io reports both a native all-time total and 90 days of daily history.
 */

import type { PackageConfig, DownloadMetrics, DailySnapshot } from '../types/index.js';
import { fetchNpmDaily, fetchNpmRange } from './npm.js';
import { fetchPypiRecent, fetchPypiRange } from './pypi.js';
import { fetchNugetTotal } from './nuget.js';
import { fetchCratesTotal, fetchCratesRange } from './crates.js';
import { fetchRubygemsTotal } from './rubygems.js';

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
      // npm lags ~1-2 days: "today" always reads 0. Anchor the running sum on
      // the last date we actually summed (total_through), not the snapshot date —
      // the snapshot date advances daily even when no new npm data has posted,
      // which permanently skips those days. Only advance the anchor to the last
      // nonzero day so still-pending days are re-queried next run.
      if (prevDate && prev?.total !== undefined) {
        const anchor = prev.total_through ?? prevDate;
        const range = await fetchNpmRange(config.name, addDays(anchor, 1), today);
        let delta = 0;
        let daily: number | undefined;
        let through = anchor;
        for (const d of [...range.keys()].sort()) {
          const v = range.get(d) ?? 0;
          if (d > anchor && v > 0) {
            delta += v;
            through = d;
            daily = v;
          }
        }
        return { daily, total: prev.total + delta, total_through: through };
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

    case 'crates': {
      // Native total and native daily history — no running sum needed. Today's
      // bucket is partial, so report complete days only.
      const [total, range] = await Promise.all([fetchCratesTotal(config.name), fetchCratesRange(config.name)]);
      const days = [...range.keys()].filter((d) => d < today).sort();
      const sumLast = (n: number) =>
        days.length >= n ? days.slice(-n).reduce((s, d) => s + (range.get(d) ?? 0), 0) : undefined;
      const last = days[days.length - 1];
      return {
        daily: last ? range.get(last) : undefined,
        last_week: sumLast(7),
        last_month: sumLast(30),
        total,
      };
    }

    case 'nuget':
    case 'rubygems': {
      const total = config.registry === 'nuget'
        ? await fetchNugetTotal(config.name)
        : await fetchRubygemsTotal(config.name);
      if (prev?.total === undefined || !prevDate) return { total };
      const gap = daysBetween(prevDate, today);
      const delta = Math.max(0, total - prev.total);
      // Gaps > 1 day mean the diff spans multiple days — report per-day average
      // so the daily chart doesn't spike.
      return { daily: gap > 0 ? Math.round(delta / gap) : undefined, total };
    }
  }
}
