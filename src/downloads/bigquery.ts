/**
 * PyPI download stats via Google BigQuery.
 *
 * The Linehaul project streams pip download logs into
 * bigquery-public-data.pypi.file_downloads, partitioned by day on `timestamp`
 * and clustered by `project`. Filtering on both keeps scanned bytes small
 * enough to stay well inside the 1 TB/mo free tier on a daily cadence.
 *
 * Auth: @google-cloud/bigquery auto-resolves GOOGLE_APPLICATION_CREDENTIALS
 * (service-account JSON path). The bigquery workflow writes BQ_KEY to a temp
 * file and points the env var at it.
 */

import { BigQuery } from '@google-cloud/bigquery';
import type { DownloadMetrics, VersionDownloadsData } from '../types/index.js';

interface Row {
  date: string;
  version: string;
  downloads: number;
}

/**
 * Fetch per-version daily download counts for a PyPI package from BigQuery.
 *
 * @param pkg   PyPI project name (e.g. "mcp")
 * @param since Only query rows on or after this date (YYYY-MM-DD). Partition
 *              pruning keys on this — passing a small window keeps scan cost
 *              proportional to the number of new days, not the dataset size.
 */
export async function fetchPypiVersions(pkg: string, since: string): Promise<VersionDownloadsData> {
  const bq = new BigQuery();

  // FORMAT_DATE returns a plain STRING, sidestepping the client's DATE-type
  // decoder (which errors with "timestamp_output_format is not supported yet"
  // on recent BigQuery backend responses). Partition pruning keys on the
  // raw timestamp column, so compare against TIMESTAMP(@since) rather than
  // the formatted string.
  const [rows] = await bq.query({
    query: `
      SELECT
        FORMAT_DATE('%Y-%m-%d', DATE(timestamp)) AS date,
        file.version AS version,
        COUNT(*) AS downloads
      FROM \`bigquery-public-data.pypi.file_downloads\`
      WHERE file.project = @pkg
        AND timestamp >= TIMESTAMP(@since)
      GROUP BY date, version
      ORDER BY date, version
    `,
    params: { pkg, since },
  });

  const daily: Record<string, Record<string, number>> = {};
  const totals: Record<string, number> = {};

  for (const row of rows as Row[]) {
    (daily[row.date] ??= {})[row.version] = Number(row.downloads);
    totals[row.version] = (totals[row.version] ?? 0) + Number(row.downloads);
  }

  return { lastUpdated: new Date().toISOString(), daily, totals };
}

/**
 * Merge freshly-queried data into an existing versions.json, recomputing
 * totals from the combined daily map so they stay consistent.
 */
export function mergeVersionData(
  existing: VersionDownloadsData | undefined,
  fresh: VersionDownloadsData,
): VersionDownloadsData {
  const daily = { ...existing?.daily, ...fresh.daily };
  const totals: Record<string, number> = {};
  for (const byVersion of Object.values(daily)) {
    for (const [v, n] of Object.entries(byVersion)) {
      totals[v] = (totals[v] ?? 0) + n;
    }
  }
  return { lastUpdated: fresh.lastUpdated, daily, totals };
}

/**
 * Collapse per-version data into aggregate DownloadMetrics for the main
 * dashboard (the same shape the npm/nuget fetchers produce).
 */
export function deriveDownloadMetrics(v: VersionDownloadsData): DownloadMetrics {
  const dates = Object.keys(v.daily).sort();
  const sumDay = (d: string) => Object.values(v.daily[d]).reduce((a, b) => a + b, 0);

  // Most-recent nonzero day — PyPI logs batch with lag so trailing zeros
  // mean "not posted yet", not zero downloads.
  let daily: number | undefined;
  for (let i = dates.length - 1; i >= 0; i--) {
    const n = sumDay(dates[i]);
    if (n > 0) { daily = n; break; }
  }

  const sumLastN = (n: number) => dates.slice(-n).reduce((s, d) => s + sumDay(d), 0);
  const total = Object.values(v.totals).reduce((a, b) => a + b, 0);

  return {
    daily,
    last_week: dates.length >= 7 ? sumLastN(7) : undefined,
    last_month: dates.length >= 30 ? sumLastN(30) : undefined,
    total,
  };
}
