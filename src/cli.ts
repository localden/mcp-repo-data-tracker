/**
 * CLI argument parsing
 */

export interface CliArgs {
  dryRun: boolean;
  verbose: boolean;
  configPath?: string;
  // Legacy single-repo mode (deprecated, use config file instead)
  owner?: string;
  repo?: string;
}

export function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  const result: CliArgs = {
    dryRun: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--dry-run' || arg === '-n') {
      result.dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      result.verbose = true;
    } else if ((arg === '--config' || arg === '-c') && args[i + 1]) {
      result.configPath = args[++i];
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
  --config, -c <path>  Path to repos.json configuration file (default: ./repos.json)
  --dry-run, -n        Compute metrics but don't write files
  --verbose, -v        Enable verbose logging
  --help, -h           Show this help message

Legacy Options (deprecated, use config file instead):
  --owner <name>       Repository owner
  --repo <name>        Repository name

Environment Variables:
  GITHUB_TOKEN         GitHub Personal Access Token (required)
  GH_PAT               Alternative name for GitHub token

Configuration File (repos.json):
  {
    "repositories": [
      { "owner": "org", "repo": "repo-name", "name": "Display Name" }
    ],
    "maintainers": {
      "source": "github",
      "owner": "org",
      "repo": "access-repo",
      "path": "path/to/users.ts"
    }
  }
`);
}
