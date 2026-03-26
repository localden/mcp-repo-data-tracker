/**
 * NuGet download stats via the Azure Search API.
 * NuGet only exposes cumulative totalDownloads — no per-day breakdown.
 */

const SEARCH_URL = 'https://azuresearch-usnc.nuget.org/query';

interface NugetSearchResponse {
  totalHits: number;
  data: Array<{ id: string; totalDownloads: number }>;
}

export async function fetchNugetTotal(pkg: string): Promise<number> {
  const res = await fetch(`${SEARCH_URL}?q=packageid:${encodeURIComponent(pkg)}`);
  if (!res.ok) throw new Error(`NuGet API ${res.status} for ${pkg}`);
  const data = (await res.json()) as NugetSearchResponse;
  const entry = data.data.find((d) => d.id.toLowerCase() === pkg.toLowerCase());
  if (!entry) throw new Error(`NuGet package not found: ${pkg}`);
  return entry.totalDownloads;
}
