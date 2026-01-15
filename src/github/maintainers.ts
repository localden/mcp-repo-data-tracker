/**
 * Fetch and parse maintainer data from modelcontextprotocol/access repository
 *
 * Maintainers are always fetched from the canonical source:
 * https://github.com/modelcontextprotocol/access/blob/main/src/config/users.ts
 */

import type { GitHubClient } from './client.js';
import type { MaintainersData, Maintainer } from '../types/index.js';

// Canonical maintainers source (constant)
const MAINTAINERS_OWNER = 'modelcontextprotocol';
const MAINTAINERS_REPO = 'access';
const MAINTAINERS_PATH = 'src/config/users.ts';

/**
 * Fetch maintainer list from modelcontextprotocol/access
 */
export async function fetchMaintainers(
  client: GitHubClient,
  verbose: boolean
): Promise<MaintainersData> {
  try {
    if (verbose) {
      console.log(`  Fetching ${MAINTAINERS_OWNER}/${MAINTAINERS_REPO}/${MAINTAINERS_PATH}`);
    }

    const response = await client.rest.repos.getContent({
      owner: MAINTAINERS_OWNER,
      repo: MAINTAINERS_REPO,
      path: MAINTAINERS_PATH,
    });

    // Handle file content (not directory)
    if (Array.isArray(response.data) || response.data.type !== 'file') {
      throw new Error('Expected file content, got directory listing');
    }

    const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
    const maintainers = parseMaintainersFromTypeScript(content, verbose);

    return {
      lastUpdated: new Date().toISOString(),
      maintainers,
    };
  } catch (error) {
    console.warn('Warning: Failed to fetch maintainer data:', error);
    console.warn('Continuing with empty maintainer list');
    return {
      lastUpdated: new Date().toISOString(),
      maintainers: [],
    };
  }
}

/**
 * Parse maintainer data from TypeScript file content
 *
 * Looks for patterns like:
 *   { github: "username", memberOf: ["CORE_MAINTAINERS", "TYPESCRIPT_SDK"] }
 */
function parseMaintainersFromTypeScript(content: string, verbose: boolean): Maintainer[] {
  const maintainers: Maintainer[] = [];

  // Match user entries with github and memberOf
  // Pattern: { ... github: "username" ... memberOf: [...] ... }
  const userBlockRegex = /\{[^{}]*github:\s*["']([^"']+)["'][^{}]*memberOf:\s*\[([^\]]*)\][^{}]*\}/g;

  let match;
  while ((match = userBlockRegex.exec(content)) !== null) {
    const github = match[1];
    const memberOfStr = match[2];

    // Extract role names from the memberOf array
    const roles = memberOfStr
      .split(',')
      .map((r) => r.trim().replace(/["']/g, ''))
      .filter((r) => r.length > 0);

    // Filter to only include roles ending with _MAINTAINERS or _SDK
    const maintainerRoles = roles.filter(
      (role) => role.endsWith('_MAINTAINERS') || role.endsWith('_SDK')
    );

    if (maintainerRoles.length > 0) {
      maintainers.push({
        github,
        roles: maintainerRoles,
      });

      if (verbose) {
        console.log(`    Found maintainer: ${github} (${maintainerRoles.join(', ')})`);
      }
    }
  }

  if (maintainers.length === 0) {
    console.warn('Warning: No maintainers found in users.ts - parsing may have failed');
  }

  return maintainers;
}
