/**
 * crates.io download stats
 * https://crates.io/data-access#api
 * crates.io requires a descriptive User-Agent on every request.
 */

const API_BASE = 'https://crates.io/api/v1/crates';
const HEADERS = { 'User-Agent': 'mcp-repo-data-tracker (https://github.com/localden/mcp-repo-data-tracker)' };

interface CrateResponse {
  crate: { name: string; downloads: number; recent_downloads: number };
  versions: Array<{ id: number; num: string; downloads: number }>;
}

interface CrateDownloadsResponse {
  version_downloads: Array<{ version: number; downloads: number; date: string }>;
  meta: { extra_downloads: Array<{ date: string; downloads: number }> };
}

async function fetchCrate(pkg: string): Promise<CrateResponse> {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(pkg)}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`crates.io API ${res.status} for ${pkg}`);
  return (await res.json()) as CrateResponse;
}

/** All-time downloads, native field. */
export async function fetchCratesTotal(pkg: string): Promise<number> {
  return (await fetchCrate(pkg)).crate.downloads;
}

/**
 * Daily download counts for the last 90 days. Returns a map of YYYY-MM-DD -> count.
 * The endpoint breaks out only the newest few versions; everything else is
 * pre-summed per date in meta.extra_downloads, so both must be added.
 * Today's bucket is partial.
 */
export async function fetchCratesRange(pkg: string): Promise<Map<string, number>> {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(pkg)}/downloads`, { headers: HEADERS });
  if (!res.ok) throw new Error(`crates.io downloads API ${res.status} for ${pkg}`);
  const data = (await res.json()) as CrateDownloadsResponse;
  const daily = new Map<string, number>();
  for (const d of [...data.version_downloads, ...data.meta.extra_downloads]) {
    daily.set(d.date, (daily.get(d.date) ?? 0) + d.downloads);
  }
  return daily;
}

/** Per-version all-time download counts. */
export async function fetchCratesVersions(pkg: string): Promise<Record<string, number>> {
  const crate = await fetchCrate(pkg);
  return Object.fromEntries(crate.versions.map((v) => [v.num, v.downloads]));
}
