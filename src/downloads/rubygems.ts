/**
 * RubyGems.org download stats
 * https://guides.rubygems.org/rubygems-org-api/
 * Like NuGet, only cumulative counts are exposed — no per-day breakdown.
 */

const API_BASE = 'https://rubygems.org/api/v1';

interface GemResponse {
  name: string;
  downloads: number;
}

interface GemVersion {
  number: string;
  downloads_count: number;
}

export async function fetchRubygemsTotal(pkg: string): Promise<number> {
  const res = await fetch(`${API_BASE}/gems/${encodeURIComponent(pkg)}.json`);
  if (!res.ok) throw new Error(`RubyGems API ${res.status} for ${pkg}`);
  return ((await res.json()) as GemResponse).downloads;
}

/** Per-version all-time download counts. */
export async function fetchRubygemsVersions(pkg: string): Promise<Record<string, number>> {
  const res = await fetch(`${API_BASE}/versions/${encodeURIComponent(pkg)}.json`);
  if (!res.ok) throw new Error(`RubyGems versions API ${res.status} for ${pkg}`);
  const versions = (await res.json()) as GemVersion[];
  return Object.fromEntries(versions.map((v) => [v.number, v.downloads_count]));
}
