# Implementation Tasks for MCP Repository Data Tracker

This document breaks down the dashboard spec into implementable chunks. Each task is self-contained and can be implemented independently (though some have dependencies).

---

## Phase 1: Project Setup & Infrastructure

### Task 1.1: Initialize Project Structure
**Status:** Not Started
**Dependencies:** None

Create the basic project structure:
- Initialize Node.js project with TypeScript
- Set up `src/` directory structure
- Configure TypeScript (`tsconfig.json`)
- Set up ESLint and Prettier
- Create `data/` directory with `.gitkeep` files

**Files to create:**
```
├── package.json
├── tsconfig.json
├── .eslintrc.js
├── .prettierrc
├── src/
│   ├── index.ts
│   ├── types/
│   │   └── index.ts
│   └── utils/
│       └── index.ts
├── data/
│   ├── .gitkeep
│   └── snapshots/
│       └── .gitkeep
```

**Acceptance criteria:**
- [ ] `npm install` runs successfully
- [ ] `npm run build` compiles TypeScript
- [ ] `npm run lint` passes

---

### Task 1.2: Define TypeScript Types
**Status:** Not Started
**Dependencies:** Task 1.1

Create all TypeScript interfaces matching the spec schemas:
- `Maintainer` and `MaintainersData`
- `Metrics` (full schema from spec)
- `DailySnapshot`
- `Contributors`
- `HotspotData`
- GitHub API response types

**Reference:** See `metrics.json Schema` and `Daily Snapshot Schema` in spec.

**Acceptance criteria:**
- [ ] All types compile without errors
- [ ] Types match spec schemas exactly

---

## Phase 2: GitHub API Integration

### Task 2.1: Implement GitHub GraphQL Client
**Status:** Not Started
**Dependencies:** Task 1.2

Create a reusable GraphQL client for GitHub API:
- Use `@octokit/graphql` package
- Implement authentication via PAT
- Add rate limit tracking and logging
- Implement cursor-based pagination helper

**Files:**
- `src/github/client.ts`
- `src/github/queries.ts` (GraphQL query strings)

**Acceptance criteria:**
- [ ] Can authenticate with GitHub
- [ ] Rate limit usage is logged
- [ ] Pagination works correctly

---

### Task 2.2: Implement Maintainer Fetching
**Status:** Not Started
**Dependencies:** Task 2.1

Fetch and parse maintainer data from `modelcontextprotocol/access`:
- Fetch `src/config/users.ts` via REST API
- Parse TypeScript with regex to extract usernames and roles
- Filter users with `_MAINTAINERS` or `_SDK` suffixes
- Handle parsing failures gracefully (log warning, continue)

**Reference:** See `Maintainer Role Detection` and `TypeScript Parsing Strategy` in spec.

**Files:**
- `src/github/maintainers.ts`

**Acceptance criteria:**
- [ ] Correctly parses maintainer usernames
- [ ] Correctly identifies roles ending in `_MAINTAINERS` or `_SDK`
- [ ] Fails gracefully if parsing returns 0 results

---

### Task 2.3: Implement Issue Fetching
**Status:** Not Started
**Dependencies:** Task 2.1

Fetch issues from the target repository:
- Fetch all open issues with pagination
- Fetch closed issues (stop when `updatedAt` < 90 days)
- Include comments (first 100, fetch more if `totalCount > 100`)
- Include timeline events (REOPENED_EVENT, CLOSED_EVENT)
- Include labels

**Reference:** See `FetchIssues` and `FetchIssueComments` GraphQL queries in spec.

**Files:**
- `src/github/issues.ts`

**Acceptance criteria:**
- [ ] Fetches all open issues
- [ ] Fetches closed issues within 90-day window
- [ ] Handles issues with >100 comments
- [ ] Extracts all required fields (author, labels, timestamps, etc.)

---

### Task 2.4: Implement PR Fetching
**Status:** Not Started
**Dependencies:** Task 2.1

Fetch pull requests from the target repository:
- Fetch all open PRs with pagination
- Fetch closed/merged PRs (stop when `updatedAt` < 90 days)
- Include reviews and comments
- Include PR metadata (additions, deletions, changedFiles, isDraft)
- Include timeline events (REOPENED_EVENT)

**Reference:** See `FetchPRs` GraphQL query in spec.

**Files:**
- `src/github/pulls.ts`

**Acceptance criteria:**
- [ ] Fetches all open PRs
- [ ] Fetches closed/merged PRs within 90-day window
- [ ] Handles PRs with >100 comments/reviews
- [ ] Extracts all required fields

---

### Task 2.5: Implement Hotspot Data Fetching
**Status:** Not Started
**Dependencies:** Task 2.4

Fetch file change data for merged PRs:
- Use REST API (`GET /repos/{owner}/{repo}/pulls/{pull_number}/files`)
- Only fetch for merged PRs in 90-day window
- Parallelize requests (batches of 20)
- Extract file paths and change counts

**Reference:** See `Hotspot Analysis` section in spec.

**Files:**
- `src/github/hotspots.ts`

**Acceptance criteria:**
- [ ] Fetches files for merged PRs only
- [ ] Parallelizes requests efficiently
- [ ] Respects rate limits

---

### Task 2.6: Implement Repository Stats Fetching
**Status:** Not Started
**Dependencies:** Task 2.1

Fetch repository statistics via REST API:
- Stars count
- Forks count
- Open issues count (for verification)

**Files:**
- `src/github/repo.ts`

**Acceptance criteria:**
- [ ] Returns accurate star/fork counts

---

## Phase 3: Metrics Computation

### Task 3.1: Implement Issue Metrics Calculator
**Status:** Not Started
**Dependencies:** Task 2.2, Task 2.3

Calculate all issue metrics:
- Volume metrics (open_count, closed_7d/30d/90d)
- Response time metrics (avg, median, p90, p95)
- Time to first **maintainer** response (filter by maintainer set)
- Issues without response (24h, 7d, 30d)
- Stale issues (30d, 60d, 90d no activity)
- Reopen rate
- By-label breakdown

**Reference:** See `Issue Metrics` and `Metric Calculation Logic` in spec.

**Exclusions to implement:**
- Exclude author's self-comments
- Exclude bot comments (`*[bot]`)

**Files:**
- `src/metrics/issues.ts`

**Acceptance criteria:**
- [ ] All volume metrics match manual verification
- [ ] Percentile calculations are correct
- [ ] Maintainer filtering works correctly

---

### Task 3.2: Implement PR Metrics Calculator
**Status:** Not Started
**Dependencies:** Task 2.2, Task 2.4

Calculate all PR metrics:
- Volume metrics (open_count, merged_7d/30d/90d, closed_not_merged)
- Review time metrics (avg, median, p90, p95)
- Time to first **maintainer** review (filter by maintainer set)
- PRs without review (24h, 7d, 30d)
- Merge time metrics (avg, median)
- By-size breakdown (small/medium/large based on lines changed)
- Draft count

**Reference:** See `Pull Request Metrics` and `Metric Calculation Logic` in spec.

**Size thresholds (suggested):**
- Small: <100 lines
- Medium: 100-500 lines
- Large: >500 lines

**Files:**
- `src/metrics/pulls.ts`

**Acceptance criteria:**
- [ ] All volume metrics match manual verification
- [ ] Percentile calculations are correct
- [ ] Maintainer filtering works correctly
- [ ] Size categorization is correct

---

### Task 3.3: Implement Contributor Metrics Calculator
**Status:** Not Started
**Dependencies:** Task 2.3, Task 2.4

Calculate contributor metrics:
- Track unique contributors (issue authors + PR authors)
- Active contributors in last 30 days
- First-time contributors (compare against cumulative set)
- Maintain append-only `contributors.json`

**Reference:** See `Contributors` in metrics schema.

**Files:**
- `src/metrics/contributors.ts`

**Acceptance criteria:**
- [ ] Correctly identifies unique contributors
- [ ] First-time detection works across runs
- [ ] `contributors.json` only grows (never loses names)

---

### Task 3.4: Implement Hotspot Aggregator
**Status:** Not Started
**Dependencies:** Task 2.5

Aggregate hotspot data:
- Count PRs per file
- Sum total changes per file
- Aggregate by directory
- Return top N files and directories

**Reference:** See `Hotspot Data Schema` in spec.

**Files:**
- `src/metrics/hotspots.ts`

**Acceptance criteria:**
- [ ] Top files sorted by PR count
- [ ] Directory aggregation correct
- [ ] Configurable top N

---

## Phase 4: Data Persistence

### Task 4.1: Implement Data Writers
**Status:** Not Started
**Dependencies:** Task 3.1, Task 3.2, Task 3.3, Task 3.4

Write computed data to JSON files:
- Write `metrics.json` (full current metrics)
- Write `maintainers.json` (current maintainer list)
- Update `contributors.json` (append-only merge)
- Create daily snapshot in `snapshots/YYYY-MM-DD.json`

**Reference:** See `Data Structure` and schemas in spec.

**Files:**
- `src/data/writers.ts`

**Acceptance criteria:**
- [ ] All JSON files are valid and match schemas
- [ ] Daily snapshots created with correct naming
- [ ] Contributors are merged, not replaced

---

### Task 4.2: Implement Snapshot Retention
**Status:** Not Started
**Dependencies:** Task 4.1

Manage snapshot retention:
- Keep daily snapshots for 90 days
- Consolidate older snapshots to monthly
- Delete individual daily snapshots after consolidation

**Reference:** See `Data Retention` table in spec.

**Files:**
- `src/data/retention.ts`

**Acceptance criteria:**
- [ ] Snapshots older than 90 days are consolidated
- [ ] Monthly snapshots preserve key metrics
- [ ] No data loss during consolidation

---

## Phase 5: Orchestration & CLI

### Task 5.1: Implement Main Aggregation Flow
**Status:** Not Started
**Dependencies:** All Phase 2, 3, 4 tasks

Create the main orchestration script:
1. Fetch maintainers
2. Fetch issues (open + closed 90d)
3. Fetch PRs (open + closed/merged 90d)
4. Fetch files for merged PRs
5. Fetch repo stats
6. Compute all metrics
7. Write all data files
8. Log summary

**Reference:** See `Aggregation Flow` in spec.

**Files:**
- `src/index.ts` (main entry point)
- `src/aggregator.ts` (orchestration logic)

**Acceptance criteria:**
- [ ] Full flow runs end-to-end
- [ ] All data files are written correctly
- [ ] Errors are logged clearly
- [ ] Rate limit usage is reported

---

### Task 5.2: Add CLI Configuration
**Status:** Not Started
**Dependencies:** Task 5.1

Add command-line configuration:
- `--dry-run` flag (compute but don't write)
- `--verbose` flag (detailed logging)
- Environment variable for `GITHUB_TOKEN`
- Configurable target repository (default: modelcontextprotocol/modelcontextprotocol)

**Files:**
- `src/cli.ts`

**Acceptance criteria:**
- [ ] All flags work correctly
- [ ] Missing token shows helpful error
- [ ] Dry run shows what would be written

---

## Phase 6: GitHub Actions

### Task 6.1: Create GitHub Actions Workflow
**Status:** Not Started
**Dependencies:** Task 5.1

Create the scheduled workflow:
- Run every 6 hours (`0 */6 * * *`)
- Support manual trigger (`workflow_dispatch`)
- Checkout repo, install deps, run aggregator
- Commit and push data changes

**Reference:** See `GitHub Actions Workflow` in spec.

**Files:**
- `.github/workflows/aggregate.yml`

**Acceptance criteria:**
- [ ] Workflow runs on schedule
- [ ] Manual trigger works
- [ ] Changes are committed with meaningful message
- [ ] Workflow fails gracefully on errors

---

### Task 6.2: Configure Repository Secrets
**Status:** Not Started
**Dependencies:** Task 6.1

Document required secrets setup:
- `GH_PAT` - Personal Access Token with required permissions
- Document required token scopes

**Files:**
- Update README with setup instructions

**Acceptance criteria:**
- [ ] Documentation is clear
- [ ] Required scopes are listed

---

## Phase 7: Hugo Static Site

> **Note:** This is a core part of the project, not optional. The dashboard is a Hugo static site deployed to GitHub Pages.

### Task 7.1: Initialize Hugo Site Structure
**Status:** Not Started
**Dependencies:** Task 1.1 (project structure exists)

Set up the Hugo project in the repository root:
- Run `hugo new site . --force` or manually create structure
- Create `hugo.toml` configuration
- Set up directory structure for layouts, content, static assets
- Configure `data/` directory integration (Hugo reads JSON from here natively)
- Add `public/` to `.gitignore`

**Files to create:**
```
├── hugo.toml
├── content/
│   └── _index.md
├── layouts/
│   ├── _default/
│   │   ├── baseof.html
│   │   └── single.html
│   └── index.html
├── static/
│   ├── css/
│   │   └── main.css
│   └── js/
│       └── charts.js
```

**hugo.toml configuration:**
```toml
baseURL = "https://YOUR_USERNAME.github.io/mcp-repo-data-tracker/"
languageCode = "en-us"
title = "MCP Repository Tracker"

[build]
  writeStats = true

[params]
  description = "Dashboard for modelcontextprotocol repository metrics"
```

**Acceptance criteria:**
- [ ] `hugo server` runs without errors
- [ ] Site builds with `hugo --minify`
- [ ] Data files in `data/` are accessible via `site.Data`

---

### Task 7.2: Create Base Layout and Styles
**Status:** Not Started
**Dependencies:** Task 7.1

Create the base HTML structure and CSS:
- `baseof.html` with HTML5 structure, head, body
- Navigation header with links to all pages
- Footer with last-updated timestamp
- Responsive CSS using CSS Grid/Flexbox
- Mobile-first design

**Files:**
- `layouts/_default/baseof.html`
- `layouts/partials/head.html`
- `layouts/partials/header.html`
- `layouts/partials/footer.html`
- `static/css/main.css`

**Acceptance criteria:**
- [ ] Clean, readable layout on desktop and mobile
- [ ] Navigation works between all pages
- [ ] Last updated timestamp displays from `metrics.json`

---

### Task 7.3: Create Metric Display Components
**Status:** Not Started
**Dependencies:** Task 7.2

Create reusable Hugo partials and shortcodes for displaying metrics:
- Metric card partial (single value with label)
- Metric table partial (multiple metrics in rows)
- Trend indicator (up/down arrow with percentage)
- Percentile display (avg/median/p90/p95)

**Files:**
- `layouts/partials/metric-card.html`
- `layouts/partials/metric-table.html`
- `layouts/partials/trend-indicator.html`
- `layouts/shortcodes/metric.html`

**Example usage in templates:**
```html
{{ partial "metric-card.html" (dict "label" "Open Issues" "value" .Site.Data.metrics.issues.open_count) }}
```

**Acceptance criteria:**
- [ ] Metric cards render with correct values
- [ ] Components are reusable across pages
- [ ] Styling is consistent

---

### Task 7.4: Create Overview Dashboard Page
**Status:** Not Started
**Dependencies:** Task 7.3

Build the homepage showing key metrics at a glance:
- Repository stats (stars, forks)
- Issue summary (open, closed this week/month, awaiting response)
- PR summary (open, merged this week/month, awaiting review)
- Contributor summary (total, active, first-time)
- Quick trend charts (sparklines or small charts)

**Files:**
- `layouts/index.html`
- `content/_index.md`

**Data access:**
```html
{{ $m := site.Data.metrics }}
{{ $m.issues.open_count }}
{{ $m.pulls.merged_7d }}
{{ $m.repository.stars }}
```

**Acceptance criteria:**
- [ ] All key metrics displayed
- [ ] Page loads in <2 seconds
- [ ] Mobile responsive

---

### Task 7.5: Create Issues Page
**Status:** Not Started
**Dependencies:** Task 7.3

Build the issues detail page:
- Volume metrics (open, closed 7d/30d/90d)
- Response time metrics (avg, median, p90, p95)
- Issues without response breakdown (24h, 7d, 30d)
- Label distribution (pie chart or bar chart)
- Stale issues breakdown (30d, 60d, 90d)

**Files:**
- `layouts/issues/single.html` or `layouts/_default/single.html` with type check
- `content/issues.md`

**Acceptance criteria:**
- [ ] All issue metrics from spec are displayed
- [ ] Label breakdown is visualized
- [ ] Response time percentiles shown clearly

---

### Task 7.6: Create Pull Requests Page
**Status:** Not Started
**Dependencies:** Task 7.3

Build the PR detail page:
- Volume metrics (open, merged 7d/30d/90d, closed not merged)
- Review time metrics (avg, median, p90, p95)
- Merge time metrics (avg, median)
- PRs without review breakdown
- Size distribution (small/medium/large)
- Draft count

**Files:**
- `content/pulls.md`
- Template in `layouts/`

**Acceptance criteria:**
- [ ] All PR metrics from spec are displayed
- [ ] Size distribution visualized
- [ ] Review vs merge time clearly distinguished

---

### Task 7.7: Create Contributors Page
**Status:** Not Started
**Dependencies:** Task 7.3

Build the contributors page:
- Total known contributors
- Active contributors (30d)
- First-time contributors (30d)
- (Optional) Top contributors list if data available

**Files:**
- `content/contributors.md`
- Template in `layouts/`

**Acceptance criteria:**
- [ ] Contributor counts displayed
- [ ] First-time contributors highlighted

---

### Task 7.8: Create Health & Trends Page
**Status:** Not Started
**Dependencies:** Task 7.3, Task 7.9

Build the trends page using historical snapshot data:
- Open issues over time (line chart)
- Closed/merged PRs over time (line chart)
- Response time trends (line chart)
- Stars/forks growth (line chart)
- Hotspots visualization (top changed files/directories)

**Files:**
- `content/health.md`
- Template in `layouts/`

**Data access for snapshots:**
```html
{{ range $filename, $data := site.Data.snapshots }}
  {{ $data.date }} - {{ $data.issues.open }}
{{ end }}
```

**Acceptance criteria:**
- [ ] Charts render with historical data
- [ ] Hotspots table shows top files/directories
- [ ] Trends are clearly visible

---

### Task 7.9: Integrate Chart.js for Visualizations
**Status:** Not Started
**Dependencies:** Task 7.2

Set up Chart.js for interactive charts:
- Include Chart.js from CDN or bundle locally
- Create chart initialization JavaScript
- Build Hugo partial that outputs chart canvas + data
- Support line charts, bar charts, pie/doughnut charts

**Files:**
- `static/js/charts.js`
- `layouts/partials/chart.html`

**Chart partial example:**
```html
<!-- layouts/partials/chart.html -->
<canvas id="{{ .id }}" data-chart='{{ .data | jsonify }}'></canvas>
```

```javascript
// static/js/charts.js
document.querySelectorAll('[data-chart]').forEach(canvas => {
  const data = JSON.parse(canvas.dataset.chart);
  new Chart(canvas, data);
});
```

**Acceptance criteria:**
- [ ] Charts render correctly
- [ ] Charts are responsive
- [ ] Multiple chart types work (line, bar, pie)

---

### Task 7.10: Configure GitHub Pages Deployment
**Status:** Not Started
**Dependencies:** Task 7.1, Task 6.1

Add Hugo build and deployment to the GitHub Actions workflow:
- Install Hugo in the workflow
- Build site after data aggregation
- Deploy to GitHub Pages using `peaceiris/actions-gh-pages` or native Pages action
- Configure repository for GitHub Pages (Actions source)

**Update files:**
- `.github/workflows/aggregate.yml` - add Hugo build steps

**Workflow addition:**
```yaml
- name: Setup Hugo
  uses: peaceiris/actions-hugo@v2
  with:
    hugo-version: 'latest'

- name: Build Hugo site
  run: hugo --minify

- name: Deploy to GitHub Pages
  uses: peaceiris/actions-gh-pages@v3
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    publish_dir: ./public
```

**Acceptance criteria:**
- [ ] Site builds in CI
- [ ] Site deploys to GitHub Pages
- [ ] Site is accessible at the GitHub Pages URL
- [ ] Site updates automatically when data changes

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 1.1-1.2 | Project setup and types |
| 2 | 2.1-2.6 | GitHub API integration |
| 3 | 3.1-3.4 | Metrics computation |
| 4 | 4.1-4.2 | Data persistence |
| 5 | 5.1-5.2 | CLI and orchestration |
| 6 | 6.1-6.2 | GitHub Actions (data aggregation) |
| 7 | 7.1-7.10 | **Hugo static site + GitHub Pages deployment** |

**Recommended implementation order:** 1 → 2 → 3 → 4 → 5 → 6 → 7

> **Important:** Phase 7 (Hugo) is NOT optional. The deliverable is a working static site dashboard, not just JSON data files. Phases 1-6 produce the data; Phase 7 displays it.

Each phase should be fully tested before moving to the next.

### Phase 7 Task Breakdown

| Task | Description |
|------|-------------|
| 7.1 | Initialize Hugo site structure |
| 7.2 | Create base layout and styles |
| 7.3 | Create metric display components (partials/shortcodes) |
| 7.4 | Create Overview Dashboard page |
| 7.5 | Create Issues page |
| 7.6 | Create Pull Requests page |
| 7.7 | Create Contributors page |
| 7.8 | Create Health & Trends page |
| 7.9 | Integrate Chart.js for visualizations |
| 7.10 | Configure GitHub Pages deployment |
