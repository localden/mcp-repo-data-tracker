/**
 * Per-issue tier bucketing for the issues dashboard.
 *
 * Tiers are ordered by precedence (first match wins) and each answers
 * "what should a maintainer do next." SLA thresholds track SEP-1730 Tier 1:
 * triage within 2 business days, resolve P0 within 7 days.
 */

import type {
  GitHubIssue,
  IssueRow,
  IssueTier,
  IssueTierGroup,
  IssueTiersJson,
  IssueTiersSummary,
  IssueType,
  IssuePriority,
} from '../types/index.js';

const BOT_LOGIN = 'mcp-claude';

const TYPE_LABELS = ['bug', 'enhancement', 'question', 'documentation'] as const;
const PRIORITY_LABELS = ['P0', 'P1', 'P2', 'P3'] as const;
const WAITING_LABELS = ['needs repro', 'needs confirmation'];
// "Status" labels whose presence means the issue has completed triage pass 2
const STATUS_LABELS = [
  ...WAITING_LABELS,
  'ready for work',
  'needs design',
  'needs maintainer',
  'needs more work',
  'on hold',
  'pending SEP approval',
];

const DAY_MS = 24 * 60 * 60 * 1000;

function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / DAY_MS;
}

function businessDaysSince(iso: string): number {
  const start = new Date(iso);
  const now = new Date();
  let count = 0;
  for (const t = new Date(start); t < now; t.setDate(t.getDate() + 1)) {
    const dow = t.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Row derivation
// ---------------------------------------------------------------------------

function toRow(issue: GitHubIssue, maintainers: Set<string>, owner: string, repo: string): IssueRow {
  const labels = issue.labels.nodes.map(l => l.name);
  const author = issue.author?.login ?? 'ghost';
  const comments = issue.comments.nodes.filter(c => c.author?.login);

  const type = (TYPE_LABELS.find(t => labels.includes(t)) ?? null) as IssueType | null;
  const priority = (PRIORITY_LABELS.find(p => labels.includes(p)) ?? null) as IssuePriority | null;

  // Cross-referenced from an OPEN PR → linked_prs. Dedupe; a PR can mention
  // an issue multiple times (body + commits) and each mention is a separate event.
  const linked_prs = [
    ...new Set(
      issue.timelineItems.nodes
        .filter(e => e.__typename === 'CrossReferencedEvent' && !e.isCrossRepository && e.source?.__typename === 'PullRequest' && e.source.state === 'OPEN')
        .map(e => e.source!.number!)
    ),
  ];

  // Comment timeline analysis — split maintainer/community, exclude bot from both sides.
  const maintComments = comments.filter(c => maintainers.has(c.author!.login) && c.author!.login !== author);
  const communityComments = comments.filter(c => !maintainers.has(c.author!.login) && c.author!.login !== BOT_LOGIN);
  const lastMaintAt = maintComments.at(-1)?.createdAt;
  const lastCommunityAt = communityComments.at(-1)?.createdAt;

  const has_maintainer_response = maintComments.length > 0;
  const reporter_replied = lastMaintAt != null && lastCommunityAt != null && lastCommunityAt > lastMaintAt;
  const reply_wait_days = reporter_replied ? businessDaysSince(lastCommunityAt!) : null;
  const bot_triaged = comments.some(c => c.author!.login === BOT_LOGIN);

  const age_days = daysSince(issue.createdAt);
  const age_business_days = businessDaysSince(issue.createdAt);

  // Tier is resolved in a second pass after all rows exist (for sort keys that
  // need linked-PR info). Temporarily set; finalized by assignTier below.
  const row: IssueRow = {
    number: issue.number,
    title: issue.title,
    author,
    url: `https://github.com/${owner}/${repo}/issues/${issue.number}`,
    labels,
    age_days: Math.round(age_days * 10) / 10,
    age_business_days,
    comment_count: issue.comments.totalCount,
    type,
    priority,
    linked_prs,
    tier: '',
    is_maintainer: maintainers.has(author),
    has_maintainer_response,
    reporter_replied,
    reply_wait_days,
    bot_triaged,
    sla_breach: false,
  };
  const tier = TIER_SPECS.find(t => t.test(row))!;
  row.tier = tier.name;
  row.sla_breach = tier.slaBreach?.(row) ?? false;
  return row;
}

// ---------------------------------------------------------------------------
// Tier specs — precedence is array order, first match wins
// ---------------------------------------------------------------------------

type GroupName = 'Critical' | 'Triage' | 'Active' | 'Hygiene' | 'Not actionable';
const GROUPS: Array<{ name: GroupName; blurb: string }> = [
  { name: 'Critical', blurb: 'P0 — drop everything.' },
  { name: 'Triage', blurb: 'Missing labels. Quick to clear — each is a 30-second decision.' },
  { name: 'Active', blurb: 'Someone is waiting on us. Longest-waiting first.' },
  { name: 'Hygiene', blurb: 'Stale — close or consciously keep.' },
  { name: 'Not actionable', blurb: 'Ball is elsewhere, or genuinely queued.' },
];

interface TierSpec {
  name: string;
  group: GroupName;
  blurb: string;
  test: (i: IssueRow) => boolean;
  sort?: (a: IssueRow, b: IssueRow) => number;
  slaBreach?: (i: IssueRow) => boolean;
}

const ageDesc = (a: IssueRow, b: IssueRow) => b.age_days - a.age_days;
const prioRank = (p: IssuePriority | null) => (p === null ? 99 : PRIORITY_LABELS.indexOf(p));

const backlogSort = (a: IssueRow, b: IssueRow) =>
  prioRank(a.priority) - prioRank(b.priority) ||
  b.comment_count - a.comment_count ||
  b.age_days - a.age_days;

const TIER_SPECS: TierSpec[] = [
  {
    name: 'Critical',
    group: 'Critical',
    blurb: 'SEP-1730: resolve within 7 days.',
    test: i => i.priority === 'P0',
    slaBreach: i => i.age_days > 7,
  },
  {
    name: 'Untriaged',
    group: 'Triage',
    blurb: 'SEP-1730: apply type label within 2 business days.',
    test: i => i.type === null || i.labels.includes('needs-triage'),
    slaBreach: i => i.age_business_days > 2,
  },
  {
    name: 'Partially triaged',
    group: 'Triage',
    blurb: 'Has a type label but no priority or status — finish triage.',
    test: i => i.priority === null && !STATUS_LABELS.some(l => i.labels.includes(l)),
    slaBreach: i => i.age_business_days > 2,
  },
  {
    name: 'Needs reply',
    group: 'Active',
    blurb: 'Reporter answered after our last comment — respond.',
    test: i => i.reporter_replied,
    slaBreach: i => (i.reply_wait_days ?? 0) > 2,
  },
  {
    name: 'Community active',
    group: 'Active',
    blurb: 'The community is debugging/discussing; no maintainer has engaged. Adopt their answer or redirect.',
    test: i => !i.has_maintainer_response && i.comment_count >= 3,
  },
  {
    name: 'PR in flight',
    group: 'Active',
    blurb: 'A community PR references this issue — go review it.',
    test: i => i.linked_prs.length > 0,
    sort: ageDesc,
  },
  {
    name: 'Close candidates',
    group: 'Hygiene',
    blurb: 'Asked for repro/confirmation over 60 days ago with no reply — verify and close.',
    test: i => WAITING_LABELS.some(l => i.labels.includes(l)) && !i.reporter_replied && i.age_days > 60,
  },
  {
    name: 'Stale backlog',
    group: 'Hygiene',
    blurb: 'In the queue for over 90 days — close or actually prioritize.',
    test: i => i.age_days > 90,
    sort: backlogSort,
    slaBreach: i => i.priority === 'P1',
  },
  {
    name: 'Waiting on reporter',
    group: 'Not actionable',
    blurb: 'Asked for repro/confirmation — ball is with the author.',
    test: i => WAITING_LABELS.some(l => i.labels.includes(l)) && !i.reporter_replied,
  },
  {
    name: 'Upstream blocked',
    group: 'Not actionable',
    blurb: 'Blocked on a SEP decision.',
    test: i => i.labels.includes('pending SEP approval'),
  },
  {
    name: 'Parked',
    group: 'Not actionable',
    blurb: 'Intentionally on hold.',
    test: i => i.labels.includes('on hold'),
  },
  {
    name: 'Backlog',
    group: 'Not actionable',
    blurb: 'Triaged, not blocked, under 90 days — plan into a sprint.',
    test: () => true,
    sort: backlogSort,
  },
];

// ---------------------------------------------------------------------------

function computeSummary(rows: IssueRow[]): IssueTiersSummary {
  const by_type = { bug: 0, enhancement: 0, question: 0, documentation: 0 };
  for (const r of rows) if (r.type) by_type[r.type]++;

  const inTier = (name: string) => rows.filter(r => r.tier === name);
  const breachIn = (name: string) => inTier(name).filter(r => r.sla_breach).length;

  return {
    open_count: rows.length,
    by_type,
    untriaged_count: inTier('Untriaged').length,
    partially_triaged_count: inTier('Partially triaged').length,
    sla: {
      triage_2bd_breach: breachIn('Untriaged') + breachIn('Partially triaged'),
      reply_2bd_breach: breachIn('Needs reply'),
      p0_7d_breach: breachIn('Critical'),
      p1_90d_breach: rows.filter(r => r.priority === 'P1' && r.age_days > 90).length,
    },
  };
}

export function buildIssueTiers(
  issues: GitHubIssue[],
  maintainers: Set<string>,
  owner: string,
  repo: string
): IssueTiersJson {
  const rows = issues
    .filter(i => i.state === 'OPEN')
    .map(i => toRow(i, maintainers, owner, repo));

  const tiers: IssueTier[] = TIER_SPECS.map(spec => ({
    name: spec.name,
    blurb: spec.blurb,
    issues: rows.filter(r => r.tier === spec.name).sort(spec.sort ?? ageDesc),
  })).filter(t => t.issues.length > 0);

  // Group tiers by GROUP_ORDER; drop empty groups.
  const specByName = new Map(TIER_SPECS.map(s => [s.name, s]));
  const groups: IssueTierGroup[] = GROUPS.map(g => ({
    name: g.name,
    blurb: g.blurb,
    tiers: tiers.filter(t => specByName.get(t.name)!.group === g.name),
  })).filter(g => g.tiers.length > 0);

  return {
    lastUpdated: new Date().toISOString(),
    summary: computeSummary(rows),
    groups,
  };
}
