/**
 * One-off: seed existing daily snapshots with downloads.daily (and downloads.total
 * for npm) from registry range APIs. NuGet has no history API and is skipped.
 *
 * Run: npm run build && npm run backfill
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { loadConfig } from './config/loader.js';
import { fetchNpmRange } from './downloads/npm.js';
import { fetchPypiRange } from './downloads/pypi.js';
import type { DailySnapshot, PackageConfig } from './types/index.js';

/** Rolling 7-day sum ending on each date. */
function rollingWeekly(daily: Map<string, number>): Map<string, number> {
  const dates = [...daily.keys()].sort();
  const weekly = new Map<string, number>();
  for (let i = 0; i < dates.length; i++) {
    let sum = 0;
    for (let j = Math.max(0, i - 6); j <= i; j++) sum += daily.get(dates[j]) ?? 0;
    weekly.set(dates[i], sum);
  }
  return weekly;
}

async function fetchHistory(
  pkg: PackageConfig,
  earliest: string,
  today: string
): Promise<{ daily: Map<string, number>; cumulative?: Map<string, number>; weekly?: Map<string, number> }> {
  switch (pkg.registry) {
    case 'npm': {
      // Fetch with a 6-day lead so the rolling-week sum has a full window at
      // `earliest`. The 18-month API cap is fine — our snapshots only go back
      // a few months.
      const lead = new Date(new Date(earliest).getTime() - 6 * 86400000).toISOString().split('T')[0];
      const daily = await fetchNpmRange(pkg.name, lead, today);
      const weekly = rollingWeekly(daily);
      let running = 0;
      const cumulative = new Map<string, number>();
      for (const date of [...daily.keys()].sort()) {
        running += daily.get(date) ?? 0;
        cumulative.set(date, running);
      }
      // Shift to absolute: add everything before the lead so totals are true all-time.
      // npm range API is inclusive on both ends, so subtract the boundary day to avoid
      // double-counting (it's already the first entry in `daily`).
      const prior = await fetchNpmRange(pkg.name, '2024-01-01', lead);
      const priorSum = [...prior.values()].reduce((a, b) => a + b, 0) - (prior.get(lead) ?? 0);
      for (const [d, v] of cumulative) cumulative.set(d, v + priorSum);
      return { daily, cumulative, weekly };
    }
    case 'pypi': {
      const daily = await fetchPypiRange(pkg.name);
      // pypistats caps at ~6 months, so this cumulative is "since pypistats retention
      // window" not true all-time. Still useful as a trend baseline.
      let running = 0;
      const cumulative = new Map<string, number>();
      for (const date of [...daily.keys()].sort()) {
        running += daily.get(date) ?? 0;
        cumulative.set(date, running);
      }
      return { daily, cumulative, weekly: rollingWeekly(daily) };
    }
    case 'nuget':
      return { daily: new Map() };
  }
}

async function main() {
  const config = await loadConfig();
  const today = new Date().toISOString().split('T')[0];

  for (const repo of config.repositories) {
    if (!repo.package) continue;

    const snapDir = join('data', 'repos', repo.owner, repo.repo, 'snapshots');
    let files: string[];
    try {
      files = (await readdir(snapDir)).filter((f) => f.endsWith('.json')).sort();
    } catch {
      console.log(`[skip] ${repo.repo}: no snapshots dir`);
      continue;
    }
    if (files.length === 0) continue;

    const earliest = files[0].replace('.json', '');
    console.log(`[${repo.repo}] fetching ${repo.package.registry} history ${earliest}..${today}`);

    const { daily, cumulative, weekly } = await fetchHistory(repo.package, earliest, today);

    let patched = 0;
    for (const file of files) {
      const path = join(snapDir, file);
      const date = file.replace('.json', '');
      const dl = daily.get(date);
      if (dl === undefined) continue;

      const snap: DailySnapshot = JSON.parse(await readFile(path, 'utf-8'));
      snap.downloads = { daily: dl };
      const cum = cumulative?.get(date);
      if (cum !== undefined) snap.downloads.total = cum;
      const wk = weekly?.get(date);
      if (wk !== undefined) snap.downloads.last_week = wk;

      await writeFile(path, JSON.stringify(snap, null, 2));
      patched++;
    }
    console.log(`[${repo.repo}] patched ${patched}/${files.length} snapshots`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
