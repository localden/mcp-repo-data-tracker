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
