/**
 * Calculate contributor metrics
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import type { IssueData, PullRequestData, ContributorMetrics, ContributorsData } from '../types/index.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const DATA_DIR = 'data';

/**
 * Load existing contributors from contributors.json
 */
async function loadExistingContributors(): Promise<Set<string>> {
  try {
    const filePath = join(process.cwd(), DATA_DIR, 'contributors.json');
    const content = await readFile(filePath, 'utf-8');
    const data: ContributorsData = JSON.parse(content);
    return new Set(data.contributors);
  } catch {
    // File doesn't exist or is invalid - start fresh
    return new Set();
  }
}

/**
 * Calculate contributor metrics
 */
export async function calculateContributorMetrics(
  issues: IssueData,
  pulls: PullRequestData
): Promise<ContributorMetrics> {
  const now = Date.now();
  const existingContributors = await loadExistingContributors();

  // Collect all contributors from current data
  const currentContributors = new Set<string>();
  const activeContributors = new Set<string>();
  const newContributors = new Set<string>();

  // Process issues
  for (const issue of [...issues.open, ...issues.closed]) {
    const author = issue.author?.login;
    if (author) {
      currentContributors.add(author);

      // Check if active (created in last 30 days)
      const createdAt = new Date(issue.createdAt).getTime();
      if (now - createdAt < THIRTY_DAYS_MS) {
        activeContributors.add(author);

        // Check if first-time contributor
        if (!existingContributors.has(author)) {
          newContributors.add(author);
        }
      }
    }
  }

  // Process PRs
  for (const pr of [...pulls.open, ...pulls.closed]) {
    const author = pr.author?.login;
    if (author) {
      currentContributors.add(author);

      // Check if active (created in last 30 days)
      const createdAt = new Date(pr.createdAt).getTime();
      if (now - createdAt < THIRTY_DAYS_MS) {
        activeContributors.add(author);

        // Check if first-time contributor
        if (!existingContributors.has(author)) {
          newContributors.add(author);
        }
      }
    }
  }

  // Merge with existing contributors for the full list
  const allContributors = new Set([...existingContributors, ...currentContributors]);

  return {
    total_known: allContributors.size,
    active_30d: activeContributors.size,
    first_time_30d: newContributors.size,
    allContributors: Array.from(allContributors).sort(),
  };
}
