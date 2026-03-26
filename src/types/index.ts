/**
 * Type definitions for MCP Repository Data Tracker
 *
 * These types match the schemas defined in the specification.
 */

// =============================================================================
// Maintainers
// =============================================================================

export interface Maintainer {
  github: string;
  roles: string[];
}

export interface MaintainersData {
  lastUpdated: string;
  maintainers: Maintainer[];
}

// =============================================================================
// Repository Stats
// =============================================================================

export interface RepositoryStats {
  stars: number;
  forks: number;
}

// =============================================================================
// Response Time Metrics
// =============================================================================

export interface ResponseTimeMetrics {
  avg_hours: number;
  median_hours: number;
  p90_hours: number;
  p95_hours: number;
}

// =============================================================================
// Issue Metrics
// =============================================================================

export interface CloseTimeMetrics {
  avg_days: number;
  median_days: number;
  p90_days: number;
}

/** An issue that needs maintainer attention */
export interface IssueNeedingAttention {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  daysWaiting: number;
  labels: string[];
  commentCount: number;
}

export interface IssueMetrics {
  open_count: number;
  closed_7d: number;
  closed_30d: number;
  closed_90d: number;
  opened_7d: number;
  opened_30d: number;
  opened_90d: number;
  without_response_24h: number;
  without_response_7d: number;
  without_response_30d: number;
  /** Full list of issues without maintainer response, sorted by oldest first */
  issues_without_maintainer_response: IssueNeedingAttention[];
  by_label: Record<string, number>;
  response_time: ResponseTimeMetrics;
  close_time: CloseTimeMetrics;
  label_coverage_pct: number;
  unlabeled_count: number;
  stale_30d: number;
  stale_60d: number;
  stale_90d: number;
  reopen_rate: number;
}

// =============================================================================
// Pull Request Metrics
// =============================================================================

export interface MergeTimeMetrics {
  avg_hours: number;
  median_hours: number;
}

/** A PR that needs maintainer attention */
export interface PRNeedingAttention {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  daysWaiting: number;
  labels: string[];
  isDraft: boolean;
  additions: number;
  deletions: number;
  reviewCount: number;
  author: string | null;
}

export interface PRMetrics {
  open_count: number;
  merged_7d: number;
  merged_30d: number;
  merged_90d: number;
  opened_7d: number;
  opened_30d: number;
  opened_90d: number;
  closed_not_merged_90d: number;
  draft_count: number;
  without_review_24h: number;
  without_review_7d: number;
  /** Full list of PRs without maintainer review, sorted by oldest first */
  prs_without_maintainer_review: PRNeedingAttention[];
  review_time: ResponseTimeMetrics;
  merge_time: MergeTimeMetrics;
  code_review_rate_pct: number;
  rejection_rate_pct: number;
  avg_reviews_per_pr: number;
  by_size: {
    small: number;
    medium: number;
    large: number;
  };
}

// =============================================================================
// Contributor Metrics
// =============================================================================

export interface ContributorMetrics {
  total_known: number;
  active_30d: number;
  first_time_30d: number;
  retention_rate_pct: number;
  churned_30d: number;
  commits_per_week_avg: number;
  commits_per_week_trend: number[];
  /** Active contributors who are maintainers */
  active_maintainers_30d: number;
  /** Active contributors who are community members (non-maintainers) */
  active_community_30d: number;
  /** Internal: full list of contributor usernames (for append-only tracking) */
  allContributors: string[];
  /** Internal: contributors active in previous 30d window (for retention tracking) */
  previousPeriodContributors: string[];
}

// =============================================================================
// Hotspot Analysis
// =============================================================================

export interface FileHotspot {
  path: string;
  pr_count: number;
  total_changes: number;
}

export interface DirectoryHotspot {
  path: string;
  pr_count: number;
  file_count: number;
}

export interface HotspotMetrics {
  by_file: FileHotspot[];
  by_directory: DirectoryHotspot[];
  top_n: number;
}

// =============================================================================
// Full Metrics (metrics.json)
// =============================================================================

export interface Metrics {
  timestamp: string;
  repository: RepositoryStats;
  issues: IssueMetrics;
  pulls: PRMetrics;
  contributors: Omit<ContributorMetrics, 'allContributors' | 'previousPeriodContributors'>;
  hotspots: HotspotMetrics;
  downloads?: DownloadMetrics;
}

// =============================================================================
// Daily Snapshot
// =============================================================================

export interface DailySnapshot {
  date: string;
  issues: {
    open: number;
    closed_7d: number;
    closed_30d: number;
    closed_90d: number;
    opened_7d: number;
    opened_30d: number;
    opened_90d: number;
    without_response_24h: number;
    without_response_7d: number;
    without_response_30d: number;
    stale_30d: number;
    stale_60d: number;
    stale_90d: number;
    reopen_rate: number;
    response_time: {
      avg_hours: number;
      median_hours: number;
      p90_hours: number;
      p95_hours: number;
    };
    close_time: {
      avg_days: number;
      median_days: number;
      p90_days: number;
    };
    label_coverage_pct: number;
  };
  pulls: {
    open: number;
    merged_7d: number;
    merged_30d: number;
    merged_90d: number;
    opened_7d: number;
    opened_30d: number;
    opened_90d: number;
    closed_not_merged_90d: number;
    draft_count: number;
    without_review_24h: number;
    without_review_7d: number;
    review_time: {
      avg_hours: number;
      median_hours: number;
      p90_hours: number;
      p95_hours: number;
    };
    merge_time: {
      avg_hours: number;
      median_hours: number;
    };
    code_review_rate_pct: number;
    rejection_rate_pct: number;
    avg_reviews_per_pr: number;
    by_size: {
      small: number;
      medium: number;
      large: number;
    };
  };
  repository: RepositoryStats;
  contributors: {
    total: number;
    active_30d: number;
    first_time_30d: number;
    retention_rate_pct: number;
    churned_30d: number;
    commits_per_week_avg: number;
    active_maintainers_30d: number;
    active_community_30d: number;
  };
  downloads?: DownloadMetrics;
  /** Written post-hoc by the pr-actionable classifier step (jq patch in aggregate.yml), not by writeSnapshot(). */
  actionability?: ActionabilitySummary;
}

export interface ActionabilityTierRow {
  idx: number;
  name: string;
  count: number;
  auth: number;
  maint: number;
  mins: number;
}

/** Documentation-only — not imported anywhere, tsc won't catch drift. Keep in sync with _structured() in scripts/pr-actionable. */
export interface ActionabilitySummary {
  actionable_count: number;
  effort_hours: number;
  auth_count: number;
  maint_count: number;
  not_our_move_count: number;
  cluster_count: number;
  cluster_member_count: number;
  by_tier: ActionabilityTierRow[];
  by_state: Record<string, number>;
  sla: {
    first_review_7d_breach: number;
    first_review_eligible: number;
    re_review_24h_breach: number;
    re_review_eligible: number;
    maint_24h_breach: number;
    maint_eligible: number;
    actionable_target: number;
    actionable_over_target: boolean;
  };
}

// =============================================================================
// Contributors File
// =============================================================================

export interface ContributorsData {
  lastUpdated: string;
  contributors: string[];
}

// =============================================================================
// GitHub API Types - Issues
// =============================================================================

export interface GitHubComment {
  createdAt: string;
  author: {
    login: string;
  } | null;
}

export interface GitHubTimelineEvent {
  __typename?: string;
  createdAt?: string;
  // CROSS_REFERENCED_EVENT — source is the referencing PR/issue
  isCrossRepository?: boolean;
  source?: {
    __typename?: 'PullRequest' | 'Issue';
    number?: number;
    state?: 'OPEN' | 'CLOSED' | 'MERGED';
  };
}

export interface GitHubIssue {
  id: string;
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED';
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  author: {
    login: string;
  } | null;
  labels: {
    nodes: Array<{ name: string }>;
  };
  comments: {
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
    nodes: GitHubComment[];
    totalCount: number;
  };
  timelineItems: {
    nodes: GitHubTimelineEvent[];
  };
}

export interface IssueData {
  open: GitHubIssue[];
  closed: GitHubIssue[];
}

// Issue tier dashboard — per-issue rows bucketed by next action (issues.json)

export type IssueType = 'bug' | 'enhancement' | 'question' | 'documentation';
export type IssuePriority = 'P0' | 'P1' | 'P2' | 'P3';

export interface IssueRow {
  number: number;
  title: string;
  author: string;
  url: string;
  labels: string[];
  age_days: number;
  age_business_days: number;
  comment_count: number;
  type: IssueType | null;
  priority: IssuePriority | null;
  linked_prs: number[];
  tier: string;
  is_maintainer: boolean;
  has_maintainer_response: boolean;
  reporter_replied: boolean;
  reply_wait_days: number | null;
  bot_triaged: boolean;
  sla_breach: boolean;
}

export interface IssueTier {
  name: string;
  blurb: string;
  issues: IssueRow[];
}

export interface IssueTierGroup {
  name: string;
  blurb: string;
  tiers: IssueTier[];
}

export interface IssueTiersSummary {
  open_count: number;
  by_type: Record<IssueType, number>;
  untriaged_count: number;
  partially_triaged_count: number;
  sla: {
    triage_2bd_breach: number;
    reply_2bd_breach: number;
    p0_7d_breach: number;
    p1_90d_breach: number;
  };
}

export interface IssueTiersJson {
  lastUpdated: string;
  summary: IssueTiersSummary;
  groups: IssueTierGroup[];
}

// =============================================================================
// GitHub API Types - Pull Requests
// =============================================================================

export interface GitHubReview {
  createdAt: string;
  state: string;
  author: {
    login: string;
  } | null;
}

export interface GitHubPullRequest {
  id: string;
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  author: {
    login: string;
  } | null;
  assignees: {
    nodes: Array<{ login: string }>;
  };
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: {
    nodes: Array<{ name: string }>;
  };
  reviews: {
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
    nodes: GitHubReview[];
    totalCount: number;
  };
  comments: {
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
    nodes: GitHubComment[];
    totalCount: number;
  };
  timelineItems: {
    nodes: GitHubTimelineEvent[];
  };
}

export interface PullRequestData {
  open: GitHubPullRequest[];
  closed: GitHubPullRequest[];
}

// =============================================================================
// GitHub API Types - Hotspots
// =============================================================================

export interface GitHubPRFile {
  filename: string;
  additions: number;
  deletions: number;
  changes: number;
}

export interface HotspotRawData {
  prNumber: number;
  files: GitHubPRFile[];
}

// =============================================================================
// SEP (Spec Enhancement Proposal) Types
// =============================================================================

/** SEP status based on labels */
export type SEPStatus = 'proposal' | 'draft' | 'in-review' | 'accepted' | 'merged';

/** A single SEP entry */
export interface SEPEntry {
  number: number;
  title: string;
  url: string;
  author: string | null;
  sponsor: string | null;  // From assignee
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  status: SEPStatus;
  daysWaiting: number;
  daysInCurrentStatus: number;
  additions: number;
  deletions: number;
  reviewCount: number;
  labels: string[];
}

/** SEP metrics data */
export interface SEPMetrics {
  lastUpdated: string;
  /** SEPs in proposal state (no sponsor) */
  proposals: SEPEntry[];
  /** SEPs in draft state (has sponsor working on it) */
  drafts: SEPEntry[];
  /** SEPs in review */
  inReview: SEPEntry[];
  /** SEPs accepted but not yet merged */
  accepted: SEPEntry[];
  /** Merged SEPs */
  merged: SEPEntry[];
  /** Summary counts */
  counts: {
    proposal: number;
    draft: number;
    inReview: number;
    accepted: number;
    merged: number;
    total: number;
  };
}

// =============================================================================
// Package Downloads
// =============================================================================

export type PackageRegistry = 'npm' | 'pypi' | 'nuget';

export interface PackageConfig {
  registry: PackageRegistry;
  name: string;
}

export interface DownloadMetrics {
  /** Yesterday's downloads. npm/pypi native; nuget derived from consecutive total diff. */
  daily?: number;
  /** Last 7 days sum. pypi native; others summed from snapshots at render time. */
  last_week?: number;
  /** Last 30 days sum. pypi native only. */
  last_month?: number;
  /** All-time cumulative. nuget native; npm maintained as running sum; pypi omitted (pypistats caps at 6mo). */
  total?: number;
}

// =============================================================================
// Repository Configuration
// =============================================================================

export interface RepoConfig {
  owner: string;
  repo: string;
  name?: string;
  description?: string;
  package?: PackageConfig;
}

export interface ReposConfig {
  repositories: RepoConfig[];
}

/** Helper to get the path segments for a repository */
export function repoPath(config: RepoConfig): { owner: string; repo: string } {
  return { owner: config.owner, repo: config.repo };
}
