/**
 * Calculate SEP (Spec Enhancement Proposal) metrics
 *
 * SEP labels (case-insensitive):
 * - "SEP" - base label for all SEPs
 * - "proposal" - initial state (no sponsor assigned)
 * - "draft" - has a sponsor (assignee) working on it
 * - "in-review" - ready for community/maintainer review
 * - "accepted" - approved but not yet merged
 */

import type { PullRequestData, GitHubPullRequest, SEPEntry, SEPMetrics, SEPStatus } from '../types/index.js';

/**
 * Check if a PR is a SEP based on its labels
 */
function isSEP(pr: GitHubPullRequest): boolean {
  return pr.labels.nodes.some(l =>
    l.name === 'SEP' ||
    l.name.startsWith('SEP:') ||
    l.name.startsWith('SEP ')
  );
}

/**
 * Determine SEP status from labels and PR state
 * Priority order: merged > closed (rejected) > accepted > in-review/final > draft > proposal
 */
function getSEPStatus(pr: GitHubPullRequest, maintainerSet: Set<string>): SEPStatus | 'closed' {
  const labels = pr.labels.nodes.map(l => l.name.toLowerCase());

  // If merged, it's merged status (highest priority)
  if (pr.mergedAt) {
    return 'merged';
  }

  // If closed but not merged, it's rejected/abandoned - exclude from active lists
  if (pr.state === 'CLOSED') {
    return 'closed';
  }

  // Check for accepted label (second highest priority for open PRs)
  if (labels.some(l => l === 'accepted')) {
    return 'accepted';
  }

  // Check for in-review label
  if (labels.some(l => l === 'in-review' || l === 'in review')) {
    return 'in-review';
  }

  // "final" label with a maintainer assignee counts as in-review
  if (labels.some(l => l === 'final')) {
    const hasMaintainerAssignee = pr.assignees.nodes.some(a => maintainerSet.has(a.login));
    if (hasMaintainerAssignee) {
      return 'in-review';
    }
  }

  // Check for draft label (just "draft", not "SEP: draft")
  if (labels.some(l => l === 'draft')) {
    return 'draft';
  }

  // Default to proposal
  return 'proposal';
}

/**
 * Convert a PR to a SEP entry
 */
function prToSEPEntry(pr: GitHubPullRequest, owner: string, repo: string, maintainerSet: Set<string>): SEPEntry {
  const now = Date.now();
  const createdAt = new Date(pr.createdAt).getTime();
  const updatedAt = new Date(pr.updatedAt).getTime();

  const daysWaiting = Math.floor((now - createdAt) / (24 * 60 * 60 * 1000));
  const daysInCurrentStatus = Math.floor((now - updatedAt) / (24 * 60 * 60 * 1000));

  // Get sponsor from assignees (first assignee is typically the sponsor)
  const sponsor = pr.assignees.nodes.length > 0 ? pr.assignees.nodes[0].login : null;

  const status = getSEPStatus(pr, maintainerSet);

  return {
    number: pr.number,
    title: pr.title,
    url: `https://github.com/${owner}/${repo}/pull/${pr.number}`,
    author: pr.author?.login || null,
    sponsor,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    mergedAt: pr.mergedAt,
    status: status === 'closed' ? 'proposal' : status, // closed is filtered out anyway
    daysWaiting,
    daysInCurrentStatus,
    additions: pr.additions,
    deletions: pr.deletions,
    reviewCount: pr.reviews.totalCount,
    labels: pr.labels.nodes.map(l => l.name),
  };
}

/**
 * Calculate SEP metrics from pull request data
 */
export function calculateSEPMetrics(
  pulls: PullRequestData,
  owner: string,
  repo: string,
  maintainerSet: Set<string>
): SEPMetrics {
  // Include open PRs and merged PRs only (exclude closed-not-merged/rejected PRs)
  const mergedPRs = pulls.closed.filter(pr => pr.mergedAt !== null);
  const allPRs = [...pulls.open, ...mergedPRs];

  // Filter to only SEPs
  const sepPRs = allPRs.filter(isSEP);

  // Convert to SEP entries
  const sepEntries = sepPRs.map(pr => prToSEPEntry(pr, owner, repo, maintainerSet));

  // Categorize by status
  const proposals: SEPEntry[] = [];
  const drafts: SEPEntry[] = [];
  const inReview: SEPEntry[] = [];
  const accepted: SEPEntry[] = [];
  const merged: SEPEntry[] = [];

  for (const sep of sepEntries) {
    switch (sep.status) {
      case 'merged':
        merged.push(sep);
        break;
      case 'accepted':
        accepted.push(sep);
        break;
      case 'in-review':
        inReview.push(sep);
        break;
      case 'draft':
        drafts.push(sep);
        break;
      case 'proposal':
      default:
        proposals.push(sep);
    }
  }

  // Sort each list by days waiting (oldest first)
  const sortByWaiting = (a: SEPEntry, b: SEPEntry) => b.daysWaiting - a.daysWaiting;
  proposals.sort(sortByWaiting);
  drafts.sort(sortByWaiting);
  inReview.sort(sortByWaiting);
  accepted.sort(sortByWaiting);

  // Sort merged by merge date (most recent first)
  merged.sort((a, b) => {
    if (!a.mergedAt || !b.mergedAt) return 0;
    return new Date(b.mergedAt).getTime() - new Date(a.mergedAt).getTime();
  });

  return {
    lastUpdated: new Date().toISOString(),
    proposals,
    drafts,
    inReview,
    accepted,
    merged,
    counts: {
      proposal: proposals.length,
      draft: drafts.length,
      inReview: inReview.length,
      accepted: accepted.length,
      merged: merged.length,
      total: sepEntries.length,
    },
  };
}
