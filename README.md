# MCP Open Source Repository Health Tracker

[![Aggregate Repository Data](https://github.com/localden/mcp-repo-data-tracker/actions/workflows/aggregate.yml/badge.svg)](https://github.com/localden/mcp-repo-data-tracker/actions/workflows/aggregate.yml)
[![Deploy to GitHub Pages](https://github.com/localden/mcp-repo-data-tracker/actions/workflows/deploy.yml/badge.svg)](https://github.com/localden/mcp-repo-data-tracker/actions/workflows/deploy.yml)

Project designed to monitor the health of Model Context Protocol open source repositories. **Only public repositories are tracked**.

## Prerequisites

### Node.js

Node.js 18+ is required for the data aggregation scripts.

```bash
# Using nvm (recommended)
nvm install 18
nvm use 18

# Or via apt
sudo apt update
sudo apt install -y nodejs npm
```

### Hugo

Hugo is required to build the static site dashboard.

**Ubuntu/Debian:**

```bash
# Option 1: Snap (recommended - always up to date)
sudo snap install hugo

# Option 2: apt (may be older version)
sudo apt update
sudo apt install -y hugo

# Option 3: Download latest release directly (if you need extended version)
# Check https://github.com/gohugoio/hugo/releases for latest version
HUGO_VERSION="0.139.0"
wget https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_linux-amd64.deb
sudo dpkg -i hugo_extended_${HUGO_VERSION}_linux-amd64.deb
rm hugo_extended_${HUGO_VERSION}_linux-amd64.deb
```

**macOS:**

```bash
brew install hugo
```

**Verify installation:**

```bash
hugo version
# Should output something like: hugo v0.139.0+extended ...
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Create a GitHub Personal Access Token

The aggregator needs a GitHub token to fetch data from the MCP repositories.

1. Go to [GitHub Settings > Developer settings > Personal access tokens > Fine-grained tokens](https://github.com/settings/tokens?type=beta)
2. Click **"Generate new token"**
3. Configure the token:
   - **Token name**: `MCP Dashboard Aggregator`
   - **Expiration**: Choose an appropriate expiration (e.g., 90 days)
   - **Resource owner**: Your username
   - **Repository access**: Select **"Public Repositories (read-only)"**
   - **Permissions**: No additional permissions needed (public repo read is default)
4. Click **"Generate token"**
5. Copy the token (you won't see it again!)

### 3. Run Data Aggregation

```bash
# Set your token
export GITHUB_TOKEN=ghp_your_token_here

# Build the TypeScript aggregator
npm run build

# Run the aggregation (fetches data from GitHub)
npm run aggregate

# Or do a dry run first to see what would happen
npm run aggregate -- --dry-run --verbose
```

This will:
- Fetch maintainer data from `modelcontextprotocol/access`
- Fetch issues and PRs from `modelcontextprotocol/modelcontextprotocol`
- Compute metrics (response times, hotspots, etc.)
- Write JSON files to `data/`

### 4. Build and Preview the Site

```bash
# Start the Hugo development server
hugo server

# Open http://localhost:1313 in your browser
```

### 5. Build for Production

```bash
hugo --minify
# Output is in public/
```

## CLI Options

```bash
npm run aggregate -- [options]

Options:
  --dry-run, -n    Compute metrics but don't write files
  --verbose, -v    Enable verbose logging
  --owner <name>   Repository owner (default: modelcontextprotocol)
  --repo <name>    Repository name (default: modelcontextprotocol)
  --help, -h       Show help message
```

## GitHub Actions Setup

The repository includes a GitHub Actions workflow that automatically:
1. Runs data aggregation every 6 hours
2. Commits updated data to the repository
3. Builds and deploys the Hugo site to GitHub Pages

### Setting Up GitHub Actions

#### Step 1: Create a Fine-Grained Personal Access Token

Since the workflow fetches data from external repositories (`modelcontextprotocol/modelcontextprotocol` and `modelcontextprotocol/access`), you need a PAT with cross-repo access.

1. Go to [GitHub Settings > Developer settings > Personal access tokens > Fine-grained tokens](https://github.com/settings/tokens?type=beta)
2. Click **"Generate new token"**
3. Configure the token:
   - **Token name**: `MCP Dashboard GitHub Actions`
   - **Expiration**: 90 days (or longer; you'll need to rotate it when it expires)
   - **Resource owner**: Your username
   - **Repository access**: Select **"Public Repositories (read-only)"**
   - **Permissions**: No additional permissions needed
4. Click **"Generate token"**
5. Copy the token

#### Step 2: Add the Token as a Repository Secret

1. Go to your repository's **Settings** > **Secrets and variables** > **Actions**
2. Click **New repository secret**
3. Name: `GH_PAT`
4. Value: Paste your personal access token
5. Click **Add secret**

#### Step 3: Enable GitHub Pages

1. Go to your repository's **Settings** > **Pages**
2. Under **Build and deployment**:
   - Source: **GitHub Actions**
3. Save

#### Step 4: Run the Workflow

The workflow runs automatically on:
- **Schedule**: Every 6 hours (`0 */6 * * *`)
- **Manual trigger**: Go to **Actions** > **Aggregate Repository Data** > **Run workflow**

To trigger your first run:
1. Go to the **Actions** tab
2. Select "Aggregate Repository Data"
3. Click "Run workflow"
4. Select the branch and click "Run workflow"

### Workflow Permissions

The workflow requires these permissions (already configured in `aggregate.yml`):
- `contents: write` - To commit data file updates
- `pages: write` - To deploy to GitHub Pages
- `id-token: write` - For GitHub Pages deployment authentication

## Project Structure

```
├── hugo.toml              # Hugo configuration
├── content/               # Markdown content pages
│   ├── _index.md         # Homepage
│   ├── issues.md         # Issues page
│   ├── pulls.md          # Pull requests page
│   ├── contributors.md   # Contributors page
│   └── health.md         # Health & trends page
├── layouts/               # Hugo templates
│   ├── _default/         # Base templates
│   ├── partials/         # Reusable components
│   └── index.html        # Homepage template
├── static/                # Static assets
│   ├── css/main.css      # Styles
│   └── js/charts.js      # Chart.js initialization
├── data/                  # JSON data files (generated by aggregator)
│   ├── metrics.json      # Current computed metrics
│   ├── maintainers.json  # Maintainer list
│   ├── contributors.json # Cumulative contributors
│   └── snapshots/        # Daily metric snapshots
├── src/                   # TypeScript aggregation scripts
│   ├── index.ts          # Entry point
│   ├── aggregator.ts     # Main orchestration
│   ├── cli.ts            # CLI argument parsing
│   ├── github/           # GitHub API integration
│   ├── metrics/          # Metric calculators
│   ├── data/             # Data writers
│   ├── types/            # TypeScript interfaces
│   └── utils/            # Utility functions
├── .github/workflows/     # GitHub Actions
│   └── aggregate.yml     # Data sync + deploy workflow
└── public/                # Generated site (gitignored)
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     GitHub Actions (every 6h)                    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    1. Data Aggregation                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ Fetch       │  │ Fetch       │  │ Fetch       │              │
│  │ Maintainers │  │ Issues/PRs  │  │ Repo Stats  │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│         └────────────────┼────────────────┘                      │
│                          ▼                                       │
│              ┌───────────────────────┐                          │
│              │   Compute Metrics     │                          │
│              │   (response times,    │                          │
│              │   hotspots, etc.)     │                          │
│              └───────────┬───────────┘                          │
│                          ▼                                       │
│              ┌───────────────────────┐                          │
│              │   Write JSON files    │                          │
│              │   to data/            │                          │
│              └───────────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    2. Hugo Site Build                            │
│              ┌───────────────────────┐                          │
│              │   Read data/*.json    │                          │
│              │   via site.Data       │                          │
│              └───────────┬───────────┘                          │
│                          ▼                                       │
│              ┌───────────────────────┐                          │
│              │   Generate static     │                          │
│              │   HTML pages          │                          │
│              └───────────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    3. Deploy to GitHub Pages                     │
└─────────────────────────────────────────────────────────────────┘
```

## Troubleshooting

### "GITHUB_TOKEN or GH_PAT environment variable is required"

Set your GitHub token before running the aggregator:
```bash
export GITHUB_TOKEN=ghp_your_token_here
```

### Rate limit errors

The aggregator uses GitHub's GraphQL API which has a 5,000 points/hour limit. A typical run uses ~500-600 points. If you hit rate limits:
- Wait for the rate limit to reset (shown in error message)
- Use `--verbose` to see rate limit status during runs

### Hugo "Unable to locate config file"

Make sure you're running Hugo from the repository root directory where `hugo.toml` is located.

### GitHub Actions workflow fails

1. Check that `GH_PAT` secret is set in repository settings
2. Verify the token has "Public Repositories (read-only)" access
3. Check if the token has expired (fine-grained tokens have expiration dates)
4. Check the Actions log for specific error messages

### No data showing on the site

1. Run the aggregator first: `npm run build && npm run aggregate`
2. Check that `data/metrics.json` exists and has content
3. Rebuild the site: `hugo`

## Documentation

See [specs/001-first-design/](specs/001-first-design/) for the full specification and implementation tasks.

## License

MIT
