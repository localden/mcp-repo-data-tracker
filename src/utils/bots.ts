/**
 * Bot detection utilities
 *
 * Shared functions for identifying and filtering bot accounts
 * from contributor metrics.
 */

/**
 * Known bot usernames (case-insensitive matching)
 */
const KNOWN_BOTS = new Set([
  'dependabot',
  'dependabot[bot]',
  'github-actions',
  'github-actions[bot]',
  'renovate',
  'renovate[bot]',
  'codecov',
  'codecov[bot]',
  'semantic-release-bot',
  'greenkeeper[bot]',
  'snyk-bot',
  'imgbot',
  'imgbot[bot]',
  'allcontributors',
  'allcontributors[bot]',
  'stale',
  'stale[bot]',
]);

/**
 * Check if a GitHub login belongs to a bot account
 *
 * @param login - GitHub username to check
 * @returns true if the login is a bot or undefined
 */
export function isBot(login: string | undefined): boolean {
  if (!login) return true;
  const lower = login.toLowerCase();
  return KNOWN_BOTS.has(lower) || lower.endsWith('[bot]');
}
