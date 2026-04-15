/**
 * One-off: regenerate data/repos/.../issues.json for ts+py only.
 * Avoids the full aggregator (PRs/hotspots/downloads). Dev preview only.
 */
import { Octokit } from '@octokit/rest';
import { fetchIssues } from './github/issues.js';
import { fetchMaintainers } from './github/maintainers.js';
import { buildIssueTiers } from './metrics/issueTiers.js';
import { writeIssueTiers } from './data/writers.js';

const client = new Octokit({ auth: process.env.GITHUB_TOKEN || process.env.GH_TOKEN });
const maintainers = await fetchMaintainers(client as any, false);
const maintainerSet = new Set(maintainers.maintainers.map(m => m.github));

for (const repo of ['typescript-sdk', 'python-sdk']) {
  console.error(`\n=== ${repo} ===`);
  const issues = await fetchIssues(client as any, 'modelcontextprotocol', repo, false);
  console.error(`  ${issues.open.length} open issues`);
  const tiers = buildIssueTiers(issues.open, maintainerSet, 'modelcontextprotocol', repo);
  await writeIssueTiers(tiers, { owner: 'modelcontextprotocol', repo, name: repo });
  console.error(`  summary:`, JSON.stringify(tiers.summary, null, 2));
  for (const g of tiers.groups) {
    console.error(`  [${g.name}] ${g.tiers.map(t => `${t.name}:${t.issues.length}`).join(' ')}`);
  }
}
