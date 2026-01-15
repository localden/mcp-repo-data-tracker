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

export interface IssueMetrics {
  open_count: number;
  closed_7d: number;
  closed_30d: number;
  closed_90d: number;
  without_response_24h: number;
  without_response_7d: number;
  without_response_30d: number;
  by_label: Record<string, number>;
  response_time: ResponseTimeMetrics;
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

export interface PRMetrics {
  open_count: number;
  merged_7d: number;
  merged_30d: number;
  merged_90d: number;
  closed_not_merged_90d: number;
  draft_count: number;
  without_review_24h: number;
  without_review_7d: number;
  review_time: ResponseTimeMetrics;
  merge_time: MergeTimeMetrics;
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
  /** Internal: full list of contributor usernames (for append-only tracking) */
  allContributors: string[];
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
  contributors: Omit<ContributorMetrics, 'allContributors'>;
  hotspots: HotspotMetrics;
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
  };
  pulls: {
    open: number;
    merged_7d: number;
    merged_30d: number;
    merged_90d: number;
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
  createdAt: string;
}

export interface GitHubIssue {
  id: string;
  number: number;
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
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  author: {
    login: string;
  } | null;
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
// Repository Configuration
// =============================================================================

export interface RepoConfig {
  owner: string;
  repo: string;
  name?: string;
  description?: string;
}

export interface ReposConfig {
  repositories: RepoConfig[];
}

/** Helper to get the path segments for a repository */
export function repoPath(config: RepoConfig): { owner: string; repo: string } {
  return { owner: config.owner, repo: config.repo };
}
