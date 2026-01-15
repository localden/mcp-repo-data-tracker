# MCP Repository Data Tracker Dashboard Specification

## Overview
A data-driven dashboard for tracking issues and pull requests in the `modelcontextprotocol/modelcontextprotocol` repository, with automated data aggregation and repository insights.

## Architecture

### Data Collection
- **GitHub Actions** workflow runs every 6 hours (`0 */6 * * *`)
- Fetches data from GitHub API using a Personal Access Token (PAT)
- Outputs structured data to `data/` directory in JSON format
- Data files are committed back to the repository to maintain history

### Static Site Generation (Hugo)
**This project uses Hugo as the static site generator. This is a core architectural decision, not optional.**

- **Hugo** static site generator for the dashboard
- Hugo site lives in the repository root (standard Hugo structure)
- Uses Hugo's data templates to read JSON files from `data/` directory
- Generates responsive, interactive dashboard pages
- Deployed to GitHub Pages automatically on data updates

**Why Hugo:**
- Fast builds (<1 second for most sites)
- Native JSON data file support via `site.Data`
- No JavaScript framework overhead — pure static HTML
- Built-in GitHub Pages integration
- Simple deployment via GitHub Actions

### Data Structure

The dashboard stores **aggregated metrics only** — raw issue/PR data is fetched, processed, and discarded each run. This keeps the repository lightweight and focused on insights.

```
data/
├── maintainers.json       # Synced from modelcontextprotocol/access
├── metrics.json           # Current computed metrics (latest snapshot)
├── contributors.json      # Cumulative set of known contributors
└── snapshots/
    └── YYYY-MM-DD.json    # Daily metrics snapshot for trend analysis
```

### What We Store vs What We Fetch

| Data | Fetched | Stored |
|------|---------|--------|
| Open issues + comments | ✓ All | ✗ Only aggregates |
| Closed issues (90 days) | ✓ All | ✗ Only aggregates |
| Open PRs + reviews | ✓ All | ✗ Only aggregates |
| Closed/merged PRs (90 days) | ✓ All | ✗ Only aggregates |
| Maintainer roles | ✓ Once per run | ✓ `maintainers.json` |
| Repository stats | ✓ Once per run | ✓ In `metrics.json` |
| Computed metrics | — | ✓ `metrics.json` + daily snapshot |
| Contributor usernames | — | ✓ `contributors.json` (append-only) |

### Data Retention

| Data Type | Retention |
|-----------|-----------|
| `metrics.json` | Current only (replaced each sync) |
| `maintainers.json` | Current only (replaced each sync) |
| `contributors.json` | Cumulative, append-only |
| Daily snapshots | 90 days of daily, then consolidated to monthly |

### metrics.json Schema
```json
{
  "timestamp": "2026-01-14T12:00:00Z",
  "repository": {
    "stars": 1234,
    "forks": 567
  },
  "issues": {
    "open_count": 42,
    "closed_7d": 8,
    "closed_30d": 25,
    "closed_90d": 67,
    "without_response_24h": 3,
    "without_response_7d": 5,
    "without_response_30d": 8,
    "by_label": { "bug": 12, "enhancement": 18, "documentation": 5 },
    "response_time": {
      "avg_hours": 12.5,
      "median_hours": 8.2,
      "p90_hours": 36.0,
      "p95_hours": 48.0
    },
    "stale_30d": 4,
    "stale_60d": 2,
    "stale_90d": 1,
    "reopen_rate": 0.03
  },
  "pulls": {
    "open_count": 12,
    "merged_7d": 10,
    "merged_30d": 35,
    "merged_90d": 89,
    "closed_not_merged_90d": 5,
    "draft_count": 3,
    "without_review_24h": 2,
    "without_review_7d": 4,
    "review_time": {
      "avg_hours": 6.3,
      "median_hours": 4.1,
      "p90_hours": 18.0,
      "p95_hours": 24.0
    },
    "merge_time": {
      "avg_hours": 48.2,
      "median_hours": 24.5
    },
    "by_size": { "small": 45, "medium": 30, "large": 14 }
  },
  "contributors": {
    "total_known": 156,
    "active_30d": 23,
    "first_time_30d": 5
  }
}
```

### Daily Snapshot Schema
```json
{
  "date": "2026-01-14",
  "issues": {
    "open": 42,
    "closed_30d": 25,
    "response_time_median_hours": 8.2
  },
  "pulls": {
    "open": 12,
    "merged_30d": 35,
    "review_time_median_hours": 4.1
  },
  "repository": { "stars": 1234, "forks": 567 },
  "contributors": { "total": 156, "first_time_30d": 5 }
}
```

## Proposed Metrics & Insights

### Issue Metrics
1. **Volume Metrics**
   - Total open issues
   - Total closed issues
   - New issues (last 7/30 days)
   - Issues closed (last 7/30 days)
   - Net change in open issues

2. **Response Time Metrics**
   - **Time to first maintainer response** (only counting responses from CORE_MAINTAINERS, MAINTAINERS, LEAD_MAINTAINERS, or SDK-specific maintainers)
   - Average time to first maintainer response
   - Median time to first maintainer response
   - P90/P95 time to first maintainer response
   - Issues without maintainer response (>24h, >7d, >30d)
   - Average time to close
   - Median time to close
   - Response rate by maintainer role (Core vs SDK-specific)

3. **Labeling & Classification**
   - Issues by label (bug, enhancement, documentation, etc.)
   - Issues by priority (if applicable)
   - Issues without labels

4. **Activity Metrics**
   - Most commented issues
   - Recently updated issues
   - Stale issues (no activity >30/60/90 days)
   - Issue authors (top contributors)

### Pull Request Metrics
1. **Volume Metrics**
   - Total open PRs
   - Total merged PRs
   - Total closed (not merged) PRs
   - PRs opened (last 7/30 days)
   - PRs merged (last 7/30 days)

2. **Merge Time Metrics**
   - Average time to merge
   - Median time to merge
   - **Time to first maintainer review** (only counting reviews from CORE_MAINTAINERS, MAINTAINERS, LEAD_MAINTAINERS, or SDK-specific maintainers)
   - Average time to first maintainer review
   - Median time to first maintainer review
   - P90/P95 time to first maintainer review
   - PRs without maintainer review (>24h, >7d, >30d)

3. **Review Metrics**
   - PRs awaiting review
   - PRs with changes requested
   - PRs approved
   - Average reviews per PR
   - Top reviewers

4. **Size & Complexity**
   - PRs by size (lines changed)
   - PRs by files changed
   - Draft vs ready PRs

5. **Author Metrics**
   - Top PR contributors
   - First-time contributors
   - Community vs maintainer PRs

### Repository Health Metrics
1. **Community Engagement**
   - Unique contributors (issues + PRs)
   - New contributors this month
   - Contributor retention rate
   - Stars growth
   - Forks growth

2. **Maintenance Health**
   - Average issue/PR resolution time trend
   - Open issue/PR growth rate
   - Maintainer response rate
   - Percentage of issues triaged (labeled)

3. **Quality Indicators**
   - Ratio of bugs to enhancements
   - Reopen rate (issues/PRs reopened after closing)
   - PR rejection rate
   - Average comments per issue/PR

4. **Velocity Metrics**
   - Issues closed per week (rolling average)
   - PRs merged per week (rolling average)
   - Throughput trends (30/60/90 day comparison)

### Trend Analysis
1. **Time Series Charts** (from daily snapshots)
   - Open vs closed issues over time
   - PR merge rate over time
   - Contributor activity over time
   - Response time trends
   - Stars/forks growth

2. **Comparison Metrics**
   - Week-over-week changes
   - Month-over-month changes
   - 90-day rolling comparisons

## Dashboard Pages

### 1. Overview Dashboard
- Key metrics at a glance
- Trend charts
- Recent activity feed

### 2. Issues Page
- Filterable issue list
- Issue metrics and charts
- Label distribution
- Age distribution

### 3. Pull Requests Page
- PR list with status
- Merge time analytics
- Review status
- Size distribution

### 4. Contributors Page
- Top contributors
- New contributors
- Contribution trends
- Maintainer vs community ratio

### 5. Health & Trends Page
- Repository health score
- Long-term trends
- Predictive analytics (if feasible)
- Comparison with historical data

## Maintainer Role Detection

### Role Matching Rules
Maintainers are identified dynamically by parsing `modelcontextprotocol/access/src/config/users.ts` and filtering users whose `memberOf` array contains roles matching these suffix patterns:

| Suffix | Description | Example Matches |
|--------|-------------|-----------------|
| `_MAINTAINERS` | Core and specialized maintainers | `CORE_MAINTAINERS`, `LEAD_MAINTAINERS`, `DOCS_MAINTAINERS` |
| `_SDK` | SDK-specific maintainers | `PYTHON_SDK`, `TYPESCRIPT_SDK`, `RUST_SDK` |

This approach ensures that:
- New maintainer roles are automatically picked up without code changes
- New SDK roles are automatically included as they're added
- The aggregation logic stays in sync with the access control definitions

### Response Tracking Logic
1. **Fetch maintainer list** from `modelcontextprotocol/access/src/config/users.ts`
2. **Parse role assignments** and filter users with roles ending in `_MAINTAINERS` or `_SDK`
3. **Filter comments/reviews** to only count those from users with matching roles
4. **Context-aware matching**: For SDK-specific issues (detected via labels), prioritize responses from users with the corresponding `_SDK` role

### Maintainer Data Schema
```json
{
  "lastUpdated": "2026-01-14T12:00:00Z",
  "maintainers": [
    {
      "github": "username",
      "roles": ["CORE_MAINTAINERS", "TYPESCRIPT_SDK"]
    }
  ]
}
```

## Technical Implementation

### GitHub API Strategy

**Recommended Approach: GraphQL API (primary) + REST API (selective)**

GraphQL is significantly more efficient for bulk data fetching because it retrieves issues/PRs with their comments, reviews, and timeline events in a single query.

### Authentication

**Required: Personal Access Token (PAT) or GitHub App token**

| Auth Type | Rate Limit | Notes |
|-----------|------------|-------|
| Unauthenticated | 60 requests/hour | Not viable for this use case |
| PAT (classic) | 5,000 requests/hour | Recommended for simplicity |
| PAT (fine-grained) | 5,000 requests/hour | More granular permissions |
| GitHub App | 5,000 requests/hour (or more) | Best for org-level access |

**Required Token Permissions:**
- `public_repo` (classic PAT) — read access to public repositories
- Or for fine-grained PAT:
  - `Repository access`: Public repositories (read-only)
  - `Contents`: Read-only (for fetching `modelcontextprotocol/access` config)
  - `Issues`: Read-only
  - `Pull requests`: Read-only

**GitHub Actions Setup:**
```yaml
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}  # Built-in, limited to current repo
  # OR
  GH_PAT: ${{ secrets.GH_PAT }}  # Custom PAT for cross-repo access
```

> **Note:** The built-in `GITHUB_TOKEN` in GitHub Actions is scoped to the current repository only. Since we need to fetch data from `modelcontextprotocol/modelcontextprotocol` and `modelcontextprotocol/access`, a custom PAT stored as a repository secret is required.

### Rate Limits (Authenticated)

| Approach | API Calls for 1000 Issues | Rate Limit Impact |
|----------|---------------------------|-------------------|
| REST API (serial) | ~1000+ calls | 200+ requests |
| GraphQL (batched) | ~20 calls | 100-200 points |

**Rate Limit Budget (6-hour sync):**
- GraphQL: 5,000 points/hour
- Estimated usage per sync: ~550 points (well under budget)
  - ~1000 open issues + comments: ~150 points
  - ~500 open PRs + reviews: ~100 points
  - ~1000 closed issues (last 30 days): ~150 points
  - ~500 closed PRs (last 30 days): ~100 points
  - Repository stats: ~50 points

### GraphQL Queries

**Pagination Strategy:**
- Issues/PRs: Paginate with cursor (`after` parameter), 50 items per page
- Comments: Fetch first 100; if `totalCount > 100`, make follow-up query for that issue
- Reviews: Fetch first 50; virtually no PRs exceed this
- Stop fetching closed items when `updatedAt` falls outside 90-day window

**Fetch Issues (open and recently closed):**
```graphql
query FetchIssues($owner: String!, $repo: String!, $after: String, $states: [IssueState!]) {
  repository(owner: $owner, name: $repo) {
    issues(first: 50, after: $after, states: $states, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        number
        state
        createdAt
        updatedAt
        closedAt
        author { login }
        labels(first: 20) { nodes { name } }
        comments(first: 100) {
          pageInfo { hasNextPage endCursor }
          nodes {
            createdAt
            author { login }
          }
          totalCount
        }
        timelineItems(first: 50, itemTypes: [REOPENED_EVENT, CLOSED_EVENT]) {
          nodes {
            ... on ReopenedEvent { createdAt }
            ... on ClosedEvent { createdAt }
          }
        }
      }
    }
  }
}
```

**Fetch Additional Comments (when totalCount > 100):**
```graphql
query FetchIssueComments($issueId: ID!, $after: String) {
  node(id: $issueId) {
    ... on Issue {
      comments(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          createdAt
          author { login }
        }
      }
    }
  }
}
```

**Fetch PRs (open and recently closed/merged):**
```graphql
query FetchPRs($owner: String!, $repo: String!, $after: String, $states: [PullRequestState!]) {
  repository(owner: $owner, name: $repo) {
    pullRequests(first: 50, after: $after, states: $states, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        number
        state
        isDraft
        createdAt
        updatedAt
        mergedAt
        closedAt
        author { login }
        additions
        deletions
        changedFiles
        labels(first: 20) { nodes { name } }
        reviews(first: 100) {
          pageInfo { hasNextPage endCursor }
          nodes {
            createdAt
            state
            author { login }
          }
          totalCount
        }
        comments(first: 100) {
          pageInfo { hasNextPage endCursor }
          nodes {
            createdAt
            author { login }
          }
          totalCount
        }
        timelineItems(first: 20, itemTypes: [REOPENED_EVENT]) {
          nodes {
            ... on ReopenedEvent { createdAt }
          }
        }
      }
    }
  }
}
```

**Fetch Repository Stats (REST API):**
```
GET /repos/modelcontextprotocol/modelcontextprotocol
```
Returns: `stargazers_count`, `forks_count`, `open_issues_count`

### Aggregation Flow

```
1. Fetch maintainers from access repo
2. Fetch all open issues (paginated)
   └─ For each issue with comments.totalCount > 100, fetch remaining comments
3. Fetch closed issues (paginated, stop when updatedAt < 90 days ago)
4. Fetch all open PRs (paginated)
   └─ For each PR with comments/reviews.totalCount > 100, fetch remaining
5. Fetch closed/merged PRs (paginated, stop when updatedAt < 90 days ago)
6. Fetch repository stats (REST)
7. Compute all metrics in memory
8. Write metrics.json, update contributors.json, create daily snapshot if new day
9. Commit and push
```

### Metric Calculation Logic

**Time to First Maintainer Response:**
```
for each issue:
  # Exclude: issue author's own comments, bot comments
  eligible_comments = comments WHERE:
    - comment.author != issue.author
    - comment.author NOT LIKE '%[bot]'
    - comment.author IN maintainers_set

  first_response = MIN(eligible_comments.createdAt)
  time_to_response = first_response - issue.createdAt
```

**Time to First Maintainer Review (PRs):**
```
for each PR:
  # Exclude: PR author's own reviews (rare but possible), bot reviews
  eligible_reviews = reviews WHERE:
    - review.author != pr.author
    - review.author NOT LIKE '%[bot]'
    - review.author IN maintainers_set

  first_review = MIN(eligible_reviews.createdAt)
  time_to_review = first_review - pr.createdAt
```

**Reopen Rate:**
```
reopen_rate = COUNT(issues with timelineItems containing REOPENED_EVENT) / COUNT(all closed issues)
```

**First-Time Contributors:**
```
# Tracked cumulatively: maintain a set of all known contributors in snapshots
# A contributor is "first-time" if they appear in current data but not in previous snapshot's known_contributors set
```

### GitHub Actions Workflow

```yaml
name: Aggregate Repository Data
on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:  # Manual trigger
```

**Workflow Steps:**
1. Checkout repository
2. Install dependencies (Node.js with `@octokit/graphql`)
3. **Fetch maintainer roles** from `modelcontextprotocol/access` (REST API)
   - Fetch `src/config/users.ts` via contents API
   - Parse TypeScript to extract usernames with `_MAINTAINERS` or `_SDK` roles
   - Store in `data/maintainers/roles.json`
4. **Fetch issues via GraphQL** (with cursor-based pagination)
5. **Fetch PRs via GraphQL** (with cursor-based pagination)
6. **Compute metrics** (time-to-first-response, percentiles, etc.)
7. Write data files to `data/` directory
8. Commit and push changes

### Data Format

```json
{
  "timestamp": "2026-01-14T12:00:00Z",
  "issues": {
    "open": [...],
    "closed_recent": [...]
  },
  "metrics": {
    "total_open": 42,
    "avg_time_to_first_response_hours": 12.5,
    "median_time_to_first_response_hours": 8.2,
    "p95_time_to_first_response_hours": 48.0,
    "issues_without_maintainer_response": 5
  }
}
```

### Hugo Site Structure

The repository follows standard Hugo structure:

```
├── hugo.toml                 # Hugo configuration
├── content/
│   ├── _index.md            # Homepage
│   ├── issues.md            # Issues page
│   ├── pulls.md             # Pull requests page
│   ├── contributors.md      # Contributors page
│   └── health.md            # Health & trends page
├── layouts/
│   ├── _default/
│   │   ├── baseof.html      # Base template
│   │   └── single.html      # Single page template
│   ├── index.html           # Homepage template
│   ├── partials/
│   │   ├── head.html        # HTML head
│   │   ├── header.html      # Site header/nav
│   │   ├── footer.html      # Site footer
│   │   ├── metrics-card.html
│   │   └── chart.html
│   └── shortcodes/
│       ├── metric.html      # Display single metric
│       ├── metric-table.html
│       └── trend-chart.html
├── static/
│   ├── css/
│   │   └── main.css
│   └── js/
│       └── charts.js        # Chart.js initialization
├── data/                    # JSON data files (generated by aggregator)
│   ├── metrics.json
│   ├── maintainers.json
│   ├── contributors.json
│   └── snapshots/
└── public/                  # Generated site (gitignored)
```

### Hugo Data Access

Hugo templates access data files directly:

```html
<!-- In layouts/index.html -->
{{ $metrics := site.Data.metrics }}

<div class="metric-card">
  <h3>Open Issues</h3>
  <span class="value">{{ $metrics.issues.open_count }}</span>
</div>

<!-- Iterate over snapshots for charts -->
{{ range $file, $snapshot := site.Data.snapshots }}
  <!-- Build chart data -->
{{ end }}
```

### Hugo Integration Details
- Use Hugo's data templates to access JSON files via `site.Data`
- Create shortcodes for common metric displays
- Use Chart.js for visualizations (loaded from CDN or static/)
- Implement responsive design for mobile viewing
- Theme: Custom minimal theme (no external theme dependency)

## Edge Cases & Limitations

### Known Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| Closed data limited to 90 days | Cannot compute all-time historical trends | Daily snapshots preserve aggregate metrics for long-term trends |
| TypeScript parsing for maintainers | Fragile if `users.ts` format changes | Use simple regex; fail loudly if parsing fails so we notice |
| No raw issue/PR storage | Cannot drill down to individual items | Link to GitHub for details; dashboard is for aggregates |

### Excluded from Metrics

| Exclusion | Reason |
|-----------|--------|
| Author's self-comments | Not a "response" — we're measuring maintainer engagement with external issues |
| Bot comments (`*[bot]`) | Automated responses don't represent maintainer attention |
| Draft PR reviews | Draft PRs aren't ready for review; timing would be skewed |

### TypeScript Parsing Strategy

The `modelcontextprotocol/access/src/config/users.ts` file is parsed with regex:
```
Pattern: /github:\s*["']([^"']+)["']/g  → extracts GitHub usernames
Pattern: /memberOf:\s*\[([^\]]+)\]/g    → extracts role arrays
```

If parsing fails (0 maintainers found), the workflow should:
1. Log a warning
2. Skip maintainer-filtered metrics for this run
3. Continue with volume metrics that don't require maintainer data

## Deployment

**The Hugo site will be deployed to GitHub Pages.** This is the chosen deployment strategy.

### GitHub Pages Configuration
- Source: GitHub Actions (not branch-based)
- Custom domain: Optional (can be configured later)
- Build command: `hugo --minify`
- Output directory: `public/`

### Deployment Workflow
The Hugo site is built and deployed as part of the data aggregation workflow:

```yaml
# After data aggregation commits new data:
- name: Build Hugo site
  run: hugo --minify

- name: Deploy to GitHub Pages
  uses: peaceiris/actions-gh-pages@v3
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    publish_dir: ./public
```

## Open Questions

1. **Privacy**: Should we anonymize contributor data?
   - **Default**: Use GitHub usernames (public data), no anonymization needed

## Success Criteria
- Dashboard loads in <2 seconds
- Data is updated at least every 6 hours
- All metrics are accurate and verifiable
- Dashboard is mobile-responsive
- Historical data is preserved and queryable

## Hotspot Analysis

Track which files are modified most frequently across PRs to identify:
- High-churn areas that may need refactoring
- Critical paths that deserve extra review attention
- Areas where bugs cluster

### Data Collection Strategy

**Use REST API for file paths** (more efficient than GraphQL for this):
```
GET /repos/{owner}/{repo}/pulls/{pull_number}/files?per_page=300
```

| Feature | GraphQL | REST API |
|---------|---------|----------|
| Files per request | 100 max | 300 max |
| Pagination needed | Frequent | Rare (>300 files) |
| Rate limit cost | ~15 points/PR | 1 request/PR |

**Fetch Strategy:**
- Only fetch files for **merged PRs** (not open/closed-not-merged)
- Limit to PRs merged in last **90 days** (matches our closed PR window)
- Parallelize requests (10-20 concurrent) to minimize wall-clock time

### Additional API Cost

| Scenario | Requests | % of Hourly Budget |
|----------|----------|-------------------|
| 100 merged PRs (90 days) | 100 | 2% |
| 500 merged PRs (90 days) | 500 | 10% |
| 1000 merged PRs (90 days) | 1000 | 20% |

This is acceptable — even with 1000 PRs, we use only 20% of the rate limit budget for file data.

### Hotspot Data Schema

Add to `metrics.json`:
```json
{
  "hotspots": {
    "by_file": [
      { "path": "src/protocol/messages.ts", "pr_count": 45, "total_changes": 1230 },
      { "path": "src/server/handler.ts", "pr_count": 38, "total_changes": 890 },
      { "path": "docs/specification.md", "pr_count": 32, "total_changes": 456 }
    ],
    "by_directory": [
      { "path": "src/protocol/", "pr_count": 89, "file_count": 12 },
      { "path": "src/server/", "pr_count": 67, "file_count": 8 },
      { "path": "docs/", "pr_count": 45, "file_count": 15 }
    ],
    "top_n": 20
  }
}
```

### Aggregation Logic

```
1. For each merged PR in 90-day window:
   a. Fetch files via REST API (parallel batches of 20)
   b. For each file: increment file_path counter, add to changes total

2. Aggregate by directory:
   a. Group files by parent directory
   b. Count unique files touched per directory

3. Store top 20 files and top 10 directories (configurable)
```

### Updated Aggregation Flow

```
1. Fetch maintainers from access repo
2. Fetch all open issues (paginated)
   └─ For each issue with comments.totalCount > 100, fetch remaining comments
3. Fetch closed issues (paginated, stop when updatedAt < 90 days ago)
4. Fetch all open PRs (paginated)
   └─ For each PR with comments/reviews.totalCount > 100, fetch remaining
5. Fetch closed/merged PRs (paginated, stop when updatedAt < 90 days ago)
6. **Fetch files for merged PRs via REST API (parallel batches of 20)**
7. Fetch repository stats (REST)
8. Compute all metrics in memory (including hotspots)
9. Write metrics.json, update contributors.json, create daily snapshot if new day
10. Commit and push
```

## Deferred Features (Out of Scope for v1)

| Feature | Reason Deferred |
|---------|-----------------|
| Sentiment analysis | Requires ML/NLP integration — complexity not justified for v1 |
| CI/CD success rates | Separate API domain (GitHub Actions API) — can add later |
| Email/Slack notifications | Requires additional infrastructure |
| Custom date range filtering | UI complexity; can use snapshots for historical data |
| Repository comparison | Requires tracking multiple repos — scope creep |

## Future Enhancements (Post-v1)
- Notifications for key metric thresholds
- Export functionality (CSV, PDF reports)
- Comparison with other MCP ecosystem repositories
- Predictive analytics (trend extrapolation)
