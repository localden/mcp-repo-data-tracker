/**
 * NuGet download stats via the Azure Search API.
 * NuGet only exposes cumulative totalDownloads — no per-day breakdown.
 */

const SEARCH_URL = 'https://azuresearch-usnc.nuget.org/query';

interface NugetSearchResponse {
  totalHits: number;
  data: Array<{
    id: string;
    totalDownloads: number;
    versions: Array<{ version: string; downloads: number }>;
  }>;
}

async function fetchSearch(pkg: string): Promise<NugetSearchResponse['data'][number]> {
  const res = await fetch(`${SEARCH_URL}?q=packageid:${encodeURIComponent(pkg)}&prerelease=true`);
  if (!res.ok) throw new Error(`NuGet API ${res.status} for ${pkg}`);
  const data = (await res.json()) as NugetSearchResponse;
  const entry = data.data.find((d) => d.id.toLowerCase() === pkg.toLowerCase());
  if (!entry) throw new Error(`NuGet package not found: ${pkg}`);
  return entry;
}

export async function fetchNugetTotal(pkg: string): Promise<number> {
  return (await fetchSearch(pkg)).totalDownloads;
}

/**
 * Per-version cumulative download counts. NuGet only exposes all-time totals,
 * so the time series we build from these is growth curves, not daily deltas.
 */
export async function fetchNugetVersions(pkg: string): Promise<Record<string, number>> {
  const entry = await fetchSearch(pkg);
  return Object.fromEntries(entry.versions.map((v) => [v.version, v.downloads]));
}
