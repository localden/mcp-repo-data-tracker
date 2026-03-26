/**
 * npm registry download stats
 * https://github.com/npm/registry/blob/master/docs/download-counts.md
 */

const API_BASE = 'https://api.npmjs.org/downloads';

interface NpmPointResponse {
  downloads: number;
  start: string;
  end: string;
  package: string;
}

interface NpmRangeResponse {
  start: string;
  end: string;
  package: string;
  downloads: Array<{ day: string; downloads: number }>;
}

export async function fetchNpmDaily(pkg: string): Promise<number> {
  const res = await fetch(`${API_BASE}/point/last-day/${pkg}`);
  if (!res.ok) throw new Error(`npm API ${res.status} for ${pkg}`);
  const data = (await res.json()) as NpmPointResponse;
  return data.downloads;
}

/**
 * Fetch daily download counts for a date range (max 18 months per request).
 * Returns a map of YYYY-MM-DD -> count.
 */
export async function fetchNpmRange(pkg: string, start: string, end: string): Promise<Map<string, number>> {
  const res = await fetch(`${API_BASE}/range/${start}:${end}/${pkg}`);
  if (!res.ok) throw new Error(`npm range API ${res.status} for ${pkg}`);
  const data = (await res.json()) as NpmRangeResponse;
  return new Map(data.downloads.map((d) => [d.day, d.downloads]));
}

/**
 * Per-version downloads over the last 7 days. npm doesn't expose per-version
 * daily history, only this rolling-week snapshot — we accumulate our own
 * time series by storing it each run.
 */
export async function fetchNpmVersions(pkg: string): Promise<Record<string, number>> {
  const res = await fetch(`https://api.npmjs.org/versions/${encodeURIComponent(pkg)}/last-week`);
  if (!res.ok) throw new Error(`npm versions API ${res.status} for ${pkg}`);
  const data = (await res.json()) as { downloads: Record<string, number> };
  return data.downloads;
}
