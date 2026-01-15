/**
 * CLI argument parsing
 */

export interface CliArgs {
  dryRun: boolean;
  verbose: boolean;
  owner: string;
  repo: string;
}

export function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  const result: CliArgs = {
    dryRun: false,
    verbose: false,
    owner: 'modelcontextprotocol',
    repo: 'modelcontextprotocol',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--dry-run' || arg === '-n') {
      result.dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      result.verbose = true;
    } else if (arg === '--owner' && args[i + 1]) {
      result.owner = args[++i];
    } else if (arg === '--repo' && args[i + 1]) {
      result.repo = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  // Validate GitHub token
  if (!process.env.GITHUB_TOKEN && !process.env.GH_PAT) {
    console.error('Error: GITHUB_TOKEN or GH_PAT environment variable is required');
    console.error('Set it with: export GITHUB_TOKEN=your_token_here');
    process.exit(1);
  }

  return result;
}

function printHelp(): void {
  console.log(`
MCP Repository Data Tracker

Usage: npm run aggregate [options]

Options:
  --dry-run, -n    Compute metrics but don't write files
  --verbose, -v    Enable verbose logging
  --owner <name>   Repository owner (default: modelcontextprotocol)
  --repo <name>    Repository name (default: modelcontextprotocol)
  --help, -h       Show this help message

Environment Variables:
  GITHUB_TOKEN     GitHub Personal Access Token (required)
  GH_PAT           Alternative name for GitHub token
`);
}
