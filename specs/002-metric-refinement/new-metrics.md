# New Metrics: GitHub-Obtainable Additions

This document tracks metrics identified through research that are **missing from our current implementation** but **obtainable from GitHub API/GraphQL**.

## Current State (Baseline)

We currently track:
- **Issues**: open/closed counts, response times, stale counts, reopen rate
- **PRs**: open/merged counts, review times, merge times, size distribution
- **Repository**: stars, forks
- **Contributors**: total, active_30d, first_time_30d

---

## Priority 1: High-Impact Metrics

These metrics have strong research backing for predicting project health.

### 1.1 Bus Factor (Contributor Absence Factor)

| Attribute | Value |
|-----------|-------|
| **Definition** | Minimum number of contributors whose departure would halt 50% of development activity |
| **Research Backing** | Academic studies show bus factor ≥3 is critical threshold; projects with bus factor=1 have 2.7x higher abandonment rate (Avelino et al., ICSE 2016) |
| **CHAOSS Metric** | [Contributor Absence Factor](https://chaoss.community/kb/metric-contributor-absence-factor/) |
| **Actionability** | Low score → mentor new contributors, document tribal knowledge, reduce single-point-of-failure |

**Data Source**: Git commit history via GraphQL

```graphql
query GetCommitAuthors($owner: String!, $repo: String!, $since: GitTimestamp!) {
  repository(owner: $owner, name: $repo) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(first: 100, since: $since) {
            pageInfo { hasNextPage, endCursor }
            nodes {
              author {
                user { login }
              }
              committedDate
            }
          }
        }
      }
    }
  }
}
```

**Calculation**:
```
1. Count commits per author in 90-day window
2. Sort authors by commit count descending
3. Find minimum N authors whose cumulative commits ≥ 50% of total
4. Bus Factor = N
```

**Schema Addition**:
```json
{
  "contributors": {
    "bus_factor": 3,
    "bus_factor_authors": ["alice", "bob", "charlie"]
  }
}
```

**Thresholds**:
- 🟢 Healthy: ≥3
- 🟡 At Risk: 2
- 🔴 Critical: 1

---

### 1.2 Elephant Factor (Organizational Diversity)

| Attribute | Value |
|-----------|-------|
| **Definition** | Minimum number of organizations whose contributors account for 50% of commits |
| **Research Backing** | CNCF requires 2+ orgs for graduation; single-org projects have higher abandonment risk |
| **CHAOSS Metric** | [Elephant Factor](https://chaoss.community/kb/metric-elephant-factor/) |
| **Actionability** | Low score → recruit contributors from other organizations, reduce corporate dependency |

**Data Source**: User organization affiliations via GraphQL

```graphql
query GetCommitAuthorsWithOrgs($owner: String!, $repo: String!, $since: GitTimestamp!) {
  repository(owner: $owner, name: $repo) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(first: 100, since: $since) {
            nodes {
              author {
                user {
                  login
                  company
                  organizations(first: 5) {
                    nodes { login }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

**Calculation**:
```
1. Map each commit author to their primary organization
   - Use `company` field if set
   - Fall back to first organization in `organizations` list
   - Use "independent" if no org affiliation
2. Count commits per organization
3. Sort orgs by commit count descending
4. Find minimum N orgs whose cumulative commits ≥ 50% of total
5. Elephant Factor = N
```

**Schema Addition**:
```json
{
  "contributors": {
    "elephant_factor": 2,
    "org_distribution": {
      "anthropic": 45,
      "independent": 30,
      "other-corp": 15,
      "community": 10
    }
  }
}
```

**Thresholds**:
- 🟢 Healthy: ≥3
- 🟡 At Risk: 2
- 🔴 Critical: 1 (single-org dominated)

---

### 1.3 Contributor Retention Rate

| Attribute | Value |
|-----------|-------|
| **Definition** | Percentage of contributors from month N-1 who also contributed in month N |
| **Research Backing** | CHAOSS identifies "new contributors who return" as key sustainability signal |
| **CHAOSS Metric** | [New Contributors](https://chaoss.community/kb/metric-new-contributors/) (related) |
| **Actionability** | Low rate → improve onboarding, mentorship programs, reduce friction |

**Data Source**: Contributor activity across time periods (already collected)

**Calculation**:
```
1. Get set of contributors active in month N-1
2. Get set of contributors active in month N
3. Retention Rate = |intersection| / |month N-1 set| * 100
```

**Schema Addition**:
```json
{
  "contributors": {
    "retention_rate_30d": 68.5,
    "churned_30d": 12,
    "retained_30d": 26
  }
}
```

**Thresholds**:
- 🟢 Healthy: ≥60%
- 🟡 Needs Attention: 40-60%
- 🔴 Critical: <40%

---

### 1.4 Release Frequency

| Attribute | Value |
|-----------|-------|
| **Definition** | Number of releases in the last 90 days, with breakdown by type |
| **Research Backing** | CHAOSS Starter Project Health model; indicates active maintenance |
| **CHAOSS Metric** | [Release Frequency](https://chaoss.community/kb/metric-release-frequency/) |
| **Actionability** | Low frequency → establish release cadence, automate release process |

**Data Source**: GitHub Releases API

```graphql
query GetReleases($owner: String!, $repo: String!, $first: Int!) {
  repository(owner: $owner, name: $repo) {
    releases(first: $first, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes {
        tagName
        name
        createdAt
        isPrerelease
        isDraft
      }
    }
  }
}
```

**Schema Addition**:
```json
{
  "releases": {
    "total_90d": 5,
    "major_90d": 1,
    "minor_90d": 2,
    "patch_90d": 2,
    "prerelease_90d": 3,
    "last_release_date": "2026-01-10T00:00:00Z",
    "days_since_last_release": 6,
    "avg_days_between_releases": 18
  }
}
```

**Thresholds** (context-dependent):
- 🟢 Active: Release within last 30 days
- 🟡 Moderate: Release within last 90 days
- 🔴 Stale: No release in 90+ days

---

### 1.5 Label Coverage

| Attribute | Value |
|-----------|-------|
| **Definition** | Percentage of open issues that have at least one label |
| **Research Backing** | Indicates triage health; unlabeled issues are harder to prioritize |
| **Actionability** | Low coverage → improve triage process, add label automation |

**Data Source**: Issue labels (already fetched)

```graphql
# Already in existing query, just need to track:
issues {
  labels(first: 1) { totalCount }
}
```

**Calculation**:
```
Label Coverage = (issues with labels.totalCount > 0) / (total open issues) * 100
```

**Schema Addition**:
```json
{
  "issues": {
    "label_coverage_pct": 72.5,
    "unlabeled_count": 67,
    "by_label": { "bug": 45, "enhancement": 89, "documentation": 23 }
  }
}
```

**Thresholds**:
- 🟢 Good: ≥80%
- 🟡 Needs Work: 50-80%
- 🔴 Poor: <50%

---

## Priority 2: Medium-Impact Metrics

These provide useful context but are less predictive on their own.

### 2.1 Code Review Rate

| Attribute | Value |
|-----------|-------|
| **Definition** | Percentage of merged PRs that received at least one review |
| **Research Backing** | OpenSSF Scorecard high-risk check; unreviewed code increases vulnerability risk |
| **Data Source** | PR reviews (already fetched) |

**Calculation**:
```
Code Review Rate = (merged PRs with reviews.totalCount > 0) / (total merged PRs) * 100
```

**Schema Addition**:
```json
{
  "pulls": {
    "code_review_rate_pct": 85.2,
    "merged_without_review_90d": 12
  }
}
```

---

### 2.2 PR Rejection Rate

| Attribute | Value |
|-----------|-------|
| **Definition** | Percentage of closed PRs that were not merged |
| **Research Backing** | High rejection may indicate unclear contribution guidelines or quality issues |
| **Data Source** | Already have `closed_not_merged_90d` |

**Calculation**:
```
Rejection Rate = closed_not_merged_90d / (merged_90d + closed_not_merged_90d) * 100
```

**Schema Addition**:
```json
{
  "pulls": {
    "rejection_rate_pct": 33.5
  }
}
```

---

### 2.3 Average Reviews per PR

| Attribute | Value |
|-----------|-------|
| **Definition** | Mean number of reviews on merged PRs |
| **Research Backing** | Review depth indicator; single reviews may miss issues |
| **Data Source** | `reviews.totalCount` per PR |

**Schema Addition**:
```json
{
  "pulls": {
    "avg_reviews_per_pr": 1.8,
    "prs_with_multiple_reviews_pct": 42.3
  }
}
```

---

### 2.4 Commit Frequency Trend

| Attribute | Value |
|-----------|-------|
| **Definition** | Commits per week over rolling 12-week window |
| **Research Backing** | CHAOSS Evolution metric; shows development momentum |
| **Data Source** | Commit history grouped by week |

**Schema Addition**:
```json
{
  "velocity": {
    "commits_per_week_avg": 45.2,
    "commits_per_week_trend": [52, 48, 41, 55, 38, 42, 49, 51, 44, 40, 47, 45],
    "trend_direction": "stable"
  }
}
```

---

### 2.5 Time to Close (Issues)

| Attribute | Value |
|-----------|-------|
| **Definition** | Time from issue creation to close (separate from first response) |
| **Research Backing** | Resolution efficiency metric |
| **Data Source** | `closedAt - createdAt` for closed issues |

**Schema Addition**:
```json
{
  "issues": {
    "close_time": {
      "avg_days": 15.2,
      "median_days": 7.5,
      "p90_days": 45.0
    }
  }
}
```

---

### 2.6 Bot Activity Rate

| Attribute | Value |
|-----------|-------|
| **Definition** | Percentage of comments/reviews from bot accounts |
| **Research Backing** | CHAOSS Common metric; helps understand automation level |
| **Data Source** | Filter authors by `*[bot]` pattern |

**Schema Addition**:
```json
{
  "activity": {
    "bot_comments_pct": 12.5,
    "bot_reviews_pct": 8.2,
    "top_bots": ["dependabot", "github-actions"]
  }
}
```

---

## Priority 3: Nice-to-Have Metrics

### 3.1 Documentation Change Rate

| Attribute | Value |
|-----------|-------|
| **Definition** | Percentage of commits that modify documentation files |
| **Research Backing** | Academic research shows doc contributions correlate with project longevity |
| **Data Source** | Commit file paths via GraphQL |

```graphql
query GetCommitFiles($owner: String!, $repo: String!, $oid: GitObjectID!) {
  repository(owner: $owner, name: $repo) {
    object(oid: $oid) {
      ... on Commit {
        additions
        deletions
        changedFiles
        file(path: "docs/") { ... }
      }
    }
  }
}
```

**Note**: Expensive to compute; may need sampling approach.

---

### 3.2 Maintainer Response Distribution

| Attribute | Value |
|-----------|-------|
| **Definition** | Distribution of responses across maintainers |
| **Research Backing** | Shows if load is balanced or concentrated |
| **Data Source** | Cross-reference comment authors with `maintainers.json` |

**Schema Addition**:
```json
{
  "maintainers": {
    "response_distribution": {
      "alice": 45,
      "bob": 32,
      "charlie": 18,
      "others": 5
    },
    "gini_coefficient": 0.35
  }
}
```

---

### 3.3 First Contribution Type

| Attribute | Value |
|-----------|-------|
| **Definition** | What type of contribution new contributors make first |
| **Research Backing** | Onboarding path analysis |
| **Data Source** | Track first activity per contributor |

**Schema Addition**:
```json
{
  "contributors": {
    "first_contribution_type": {
      "issue": 45,
      "pr": 30,
      "comment": 20,
      "review": 5
    }
  }
}
```

---

## Implementation Plan

### Phase 1: Easy (Data Already Available)
- [ ] Label Coverage % - just compute from existing issue data
- [ ] Code Review Rate - compute from existing PR review data
- [ ] PR Rejection Rate - compute from existing PR data
- [ ] Bot Activity Rate - filter existing comment/review data

### Phase 2: Medium (Add Query Fields)
- [ ] Release Frequency - add releases query
- [ ] Average Reviews per PR - aggregate existing review counts
- [ ] Time to Close - compute from existing timestamps
- [ ] Commit Frequency Trend - add commit history query

### Phase 3: Complex (New Collection Logic)
- [ ] Bus Factor - analyze commit author distribution
- [ ] Elephant Factor - fetch user organizations
- [ ] Contributor Retention Rate - cross-period analysis
- [ ] Documentation Change Rate - file path analysis
- [ ] Maintainer Response Distribution - cross-reference with maintainers

---

## Updated Schema (Complete)

```json
{
  "timestamp": "2026-01-16T12:00:00Z",
  "repository": {
    "stars": 6903,
    "forks": 1227
  },
  "issues": {
    "open_count": 245,
    "closed_7d": 13,
    "closed_30d": 30,
    "closed_90d": 131,
    "without_response_24h": 133,
    "without_response_7d": 131,
    "response_time": {
      "avg_hours": 390.8,
      "median_hours": 45.8,
      "p90_hours": 947.1,
      "p95_hours": 2569.1
    },
    "close_time": {
      "avg_days": 15.2,
      "median_days": 7.5,
      "p90_days": 45.0
    },
    "label_coverage_pct": 72.5,
    "unlabeled_count": 67,
    "stale_30d": 208,
    "stale_60d": 181,
    "stale_90d": 165,
    "reopen_rate": 0.03
  },
  "pulls": {
    "open_count": 90,
    "merged_7d": 6,
    "merged_30d": 37,
    "merged_90d": 167,
    "closed_not_merged_90d": 84,
    "draft_count": 13,
    "review_time": {
      "avg_hours": 349.3,
      "median_hours": 15.4,
      "p90_hours": 707.8
    },
    "merge_time": {
      "avg_hours": 527.8,
      "median_hours": 39
    },
    "code_review_rate_pct": 85.2,
    "rejection_rate_pct": 33.5,
    "avg_reviews_per_pr": 1.8,
    "by_size": { "small": 50, "medium": 29, "large": 11 }
  },
  "contributors": {
    "total_known": 350,
    "active_30d": 54,
    "first_time_30d": 8,
    "bus_factor": 3,
    "elephant_factor": 2,
    "retention_rate_30d": 68.5,
    "org_distribution": {
      "anthropic": 45,
      "independent": 30,
      "other": 25
    }
  },
  "releases": {
    "total_90d": 5,
    "days_since_last_release": 6,
    "avg_days_between_releases": 18
  },
  "velocity": {
    "commits_per_week_avg": 45.2,
    "trend_direction": "stable"
  },
  "activity": {
    "bot_comments_pct": 12.5
  }
}
```

---

## References

- [CHAOSS Metrics](https://chaoss.community/kb-metrics-and-metrics-models/)
- [OpenSSF Scorecard Checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md)
- [Avelino et al. - Truck Factor Study (ICSE 2016)](https://ieeexplore.ieee.org/document/7886915)
- [CNCF Graduation Criteria](https://github.com/cncf/toc/blob/main/process/graduation_criteria.md)
