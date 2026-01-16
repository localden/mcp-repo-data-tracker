/**
 * MCP Repository Data Tracker - Main Entry Point
 */

import { aggregate } from './aggregator.js';
import { parseArgs } from './cli.js';
import { style, newline, error } from './cli/output.js';

async function main() {
  // Print banner
  console.log();
  console.log(style.bold(style.cyan('  MCP Repository Data Tracker')));
  console.log(style.dim('  Aggregating GitHub metrics for MCP repositories'));
  newline();

  const args = parseArgs();

  try {
    await aggregate(args);
  } catch (err) {
    newline();
    error(`Aggregation failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
