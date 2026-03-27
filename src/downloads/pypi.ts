/**
 * PyPI download stats via pypistats.org
 * https://pypistats.org/api/
 */

const API_BASE = 'https://pypistats.org/api/packages';

interface PypiRecentResponse {
  data: { last_day: number; last_week: number; last_month: number };
  package: string;
}

interface PypiOverallResponse {
  data: Array<{ category: string; date: string; downloads: number }>;
  package: string;
}

export async function fetchPypiRecent(
  pkg: string
): Promise<{ daily: number; last_week: number; last_month: number }> {
  const res = await fetch(`${API_BASE}/${pkg}/recent`);
  if (!res.ok) throw new Error(`pypistats API ${res.status} for ${pkg}`);
  const data = (await res.json()) as PypiRecentResponse;
  return {
    daily: data.data.last_day,
    last_week: data.data.last_week,
    last_month: data.data.last_month,
  };
}

/**
 * Fetch daily download history (pypistats retains ~6 months).
 * Returns a map of YYYY-MM-DD -> count, mirrors excluded.
 */
export async function fetchPypiRange(pkg: string): Promise<Map<string, number>> {
  const res = await fetch(`${API_BASE}/${pkg}/overall?mirrors=false`);
  if (!res.ok) throw new Error(`pypistats overall API ${res.status} for ${pkg}`);
  const data = (await res.json()) as PypiOverallResponse;
  return new Map(data.data.map((d) => [d.date, d.downloads]));
}

/**
 * Fetch the package's first-published date (YYYY-MM-DD) from PyPI's JSON API.
 * Used to bound the BigQuery bootstrap window so the total reflects full
 * lifetime downloads rather than an arbitrary lookback.
 */
export async function fetchPypiFirstPublished(pkg: string): Promise<string> {
  const res = await fetch(`https://pypi.org/pypi/${pkg}/json`);
  if (!res.ok) throw new Error(`PyPI JSON API ${res.status} for ${pkg}`);
  const data = (await res.json()) as { releases: Record<string, Array<{ upload_time: string }>> };
  const uploads = Object.values(data.releases)
    .flat()
    .map((f) => f.upload_time)
    .sort();
  if (uploads.length === 0) throw new Error(`No releases found for ${pkg}`);
  return uploads[0].split('T')[0];
}
