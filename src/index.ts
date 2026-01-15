/**
 * MCP Repository Data Tracker - Main Entry Point
 *
 * This script orchestrates the data aggregation flow:
 * 1. Fetch maintainers from access repo
 * 2. Fetch issues (open + closed 90d)
 * 3. Fetch PRs (open + closed/merged 90d)
 * 4. Fetch files for merged PRs (hotspots)
 * 5. Fetch repo stats
 * 6. Compute all metrics
 * 7. Write all data files
 */

import { aggregate } from './aggregator.js';
import { parseArgs } from './cli.js';

async function main() {
  const args = parseArgs();

  console.log('MCP Repository Data Tracker');
  console.log('===========================\n');

  if (args.dryRun) {
    console.log('Running in dry-run mode (no files will be written)\n');
  }

  try {
    await aggregate(args);
    console.log('\nAggregation complete!');
  } catch (error) {
    console.error('\nAggregation failed:', error);
    process.exit(1);
  }
}

main();
