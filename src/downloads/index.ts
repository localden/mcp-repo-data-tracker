/**
 * Package download metrics dispatcher.
 * Registry quirks:
 *   - npm/PyPI report daily natively; NuGet only cumulative → daily derived from prev-snapshot diff.
 *   - npm cumulative isn't an API field; we carry a running sum forward from the previous snapshot
 *     (seeded by the backfill script's full-range sum).
 */

import type { PackageConfig, DownloadMetrics, DailySnapshot } from '../types/index.js';
import { fetchNpmDaily } from './npm.js';
import { fetchPypiRecent } from './pypi.js';
import { fetchNugetTotal } from './nuget.js';

export async function fetchDownloads(
  config: PackageConfig,
  prevSnapshot?: DailySnapshot
): Promise<DownloadMetrics> {
  const prev = prevSnapshot?.downloads;

  switch (config.registry) {
    case 'npm': {
      const daily = await fetchNpmDaily(config.name);
      const total = prev?.total !== undefined ? prev.total + daily : undefined;
      return { daily, total };
    }

    case 'pypi': {
      return await fetchPypiRecent(config.name);
    }

    case 'nuget': {
      const total = await fetchNugetTotal(config.name);
      const daily = prev?.total !== undefined ? total - prev.total : undefined;
      return { daily, total };
    }
  }
}
