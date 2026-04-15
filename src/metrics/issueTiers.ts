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
  'needs decision',
  'needs design',
  'needs maintainer',
  'needs more work',
  'on hold',
  'pending SEP approval',
  'potentially close',
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
  const bot_comment_count = comments.filter(c => c.author!.login === BOT_LOGIN).length;
  const bot_triaged =
    bot_comment_count > 0 ||
    issue.timelineItems.nodes.some(e => e.__typename === 'LabeledEvent' && e.actor?.login === BOT_LOGIN);
  const status = STATUS_LABELS.find(l => labels.includes(l)) ?? null;
  const assignee = issue.assignees.nodes[0]?.login ?? null;

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
    bot_comment_count,
    status,
    assignee,
    sla_breach: false,
  };
  const tier = TIER_SPECS.find(t => t.test(row))!;
  row.tier = tier.name;
  row.sla_breach = tier.slaBreach?.(row) ?? false;
  return row;
}

// ---------------------------------------------------------------------------
// Tier specs — precedence is array order, first match wins.
// Groups are type-based (Bugs/Enhancements/Questions); tiers within each are
// the next maintainer action. Bot guarantees type+status+priority within ~30min,
// so "Untriaged" is a small residual, not a primary work queue.
// ---------------------------------------------------------------------------

type GroupName = 'Bugs' | 'Enhancements' | 'Questions' | 'Docs' | 'Untriaged';
const GROUPS: Array<{ name: GroupName; blurb: string }> = [
  { name: 'Bugs', blurb: 'Queue — pick the top fix-ready and work it. Priority then age.' },
  { name: 'Enhancements', blurb: 'Decisions — say yes/no, then design or implement.' },
  { name: 'Questions', blurb: 'Inbox — answer, then close or convert to bug/enhancement.' },
  { name: 'Docs', blurb: 'Documentation issues.' },
  { name: 'Untriaged', blurb: 'No type label — bot pending or needs manual triage.' },
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
const prioThenAge = (a: IssueRow, b: IssueRow) =>
  prioRank(a.priority) - prioRank(b.priority) || b.age_days - a.age_days;
const prioThenComments = (a: IssueRow, b: IssueRow) =>
  prioRank(a.priority) - prioRank(b.priority) || b.comment_count - a.comment_count;

const isInProgress = (i: IssueRow) => i.assignee != null;
const isWaiting = (i: IssueRow) => WAITING_LABELS.some(l => i.labels.includes(l)) && !i.reporter_replied;
const isBlocked = (i: IssueRow) => i.labels.includes('pending SEP approval') || i.labels.includes('on hold');
const isCloseCand = (i: IssueRow) =>
  i.labels.includes('potentially close') || (isWaiting(i) && i.age_days > 14);

const TIER_SPECS: TierSpec[] = [
  // --- Untriaged (no type) — falls through to here only via the type guards below ---
  {
    name: 'untriaged',
    group: 'Untriaged',
    blurb: 'Bot has not labeled yet, or needs manual type assignment.',
    test: i => i.type === null,
    slaBreach: i => i.age_business_days > 2,
  },

  // --- Bugs ---
  {
    name: 'in-progress',
    group: 'Bugs',
    blurb: 'Assigned — someone is on it.',
    test: i => i.type === 'bug' && isInProgress(i),
    sort: prioThenAge,
  },
  {
    name: 'fix-proposed',
    group: 'Bugs',
    blurb: 'Bot posted a suggested fix — review the diff. P0/P1 first.',
    test: i => i.type === 'bug' && i.labels.includes('fix proposed'),
    sort: prioThenAge,
    slaBreach: i => i.priority === 'P0' && i.age_days > 7,
  },
  {
    name: 'ready-for-work',
    group: 'Bugs',
    blurb: 'Triaged and reproducible — pick one up. P0/P1 first.',
    test: i => i.type === 'bug' && i.status === 'ready for work',
    sort: prioThenAge,
    slaBreach: i => i.priority === 'P0' && i.age_days > 7,
  },
  {
    name: 'needs-maintainer',
    group: 'Bugs',
    blurb: 'Reporter replied, or bot/triage flagged for maintainer judgment.',
    test: i =>
      i.type === 'bug' &&
      (i.reporter_replied || ['needs maintainer', 'needs more work', 'needs design'].includes(i.status ?? '')),
    sort: prioThenAge,
    slaBreach: i => (i.reply_wait_days ?? 0) > 2,
  },
  {
    name: 'close-candidates',
    group: 'Bugs',
    blurb: 'Bot says already-fixed/not-a-bug, or repro request expired (>14d).',
    test: i => i.type === 'bug' && isCloseCand(i),
    sort: ageDesc,
  },
  {
    name: 'waiting',
    group: 'Bugs',
    blurb: 'Reporter owes repro/confirmation, or a PR is in flight, or blocked.',
    test: i => i.type === 'bug' && (isWaiting(i) || i.linked_prs.length > 0 || isBlocked(i)),
    sort: ageDesc,
  },
  {
    name: 'backlog',
    group: 'Bugs',
    blurb: 'Triaged bug, no status — plan into a sprint or label.',
    test: i => i.type === 'bug',
    sort: prioThenAge,
    slaBreach: i => i.priority === 'P1' && i.age_days > 90,
  },

  // --- Enhancements ---
  {
    name: 'in-progress',
    group: 'Enhancements',
    blurb: 'Assigned — someone is on it.',
    test: i => i.type === 'enhancement' && isInProgress(i),
    sort: prioThenAge,
  },
  {
    name: 'decide',
    group: 'Enhancements',
    blurb: 'needs decision — say yes (→ ready/design/backlog) or no (→ close). P1 first.',
    test: i => i.type === 'enhancement' && i.status === 'needs decision',
    sort: prioThenComments,
  },
  {
    name: 'design',
    group: 'Enhancements',
    blurb: 'needs design — approved direction, scope it before implementing.',
    test: i => i.type === 'enhancement' && i.status === 'needs design',
    sort: prioThenAge,
  },
  {
    name: 'ready',
    group: 'Enhancements',
    blurb: 'ready for work — PR welcome.',
    test: i => i.type === 'enhancement' && i.status === 'ready for work',
    sort: prioThenAge,
  },
  {
    name: 'close-candidates',
    group: 'Enhancements',
    blurb: 'Bot flagged duplicate/out-of-scope, or confirmation expired.',
    test: i => i.type === 'enhancement' && isCloseCand(i),
    sort: ageDesc,
  },
  {
    name: 'waiting',
    group: 'Enhancements',
    blurb: 'Reporter owes detail, or PR in flight, or SEP/hold.',
    test: i =>
      i.type === 'enhancement' &&
      (isWaiting(i) || i.linked_prs.length > 0 || isBlocked(i) || i.reporter_replied),
    sort: ageDesc,
  },
  {
    name: 'backlog',
    group: 'Enhancements',
    blurb: 'Acknowledged, not prioritized — explicit backlog label or no status yet.',
    test: i => i.type === 'enhancement',
    sort: prioThenComments,
  },

  // --- Questions ---
  {
    name: 'answer',
    group: 'Questions',
    blurb: 'No maintainer response yet, or reporter followed up.',
    test: i => i.type === 'question' && (!i.has_maintainer_response || i.reporter_replied),
    sort: ageDesc,
    slaBreach: i => i.age_business_days > 2,
  },
  {
    name: 'close-candidates',
    group: 'Questions',
    blurb: 'Answered or bot-flagged — verify and close, or convert.',
    test: i => i.type === 'question',
    sort: ageDesc,
  },

  // --- Docs ---
  {
    name: 'docs',
    group: 'Docs',
    blurb: 'Documentation issues — fold into a docs sprint.',
    test: i => i.type === 'documentation',
    sort: prioThenAge,
  },
];

// ---------------------------------------------------------------------------

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function computeSummary(rows: IssueRow[]): IssueTiersSummary {
  const by_type = { bug: 0, enhancement: 0, question: 0, documentation: 0 };
  for (const r of rows) if (r.type) by_type[r.type]++;

  const fixProposed = rows.filter(r => r.type === 'bug' && r.labels.includes('fix proposed'));
  const fixReady = rows.filter(r => r.type === 'bug' && r.status === 'ready for work');
  const decisions = rows.filter(r => r.type === 'enhancement' && r.status === 'needs decision');
  const closeCands = rows.filter(isCloseCand);
  const p0 = rows.filter(r => r.priority === 'P0');

  return {
    open_count: rows.length,
    by_type,
    untriaged_count: rows.filter(r => r.type === null).length,
    partially_triaged_count: rows.filter(r => r.type !== null && r.status === null && r.priority === null).length,
    bugs_fix_ready: {
      total: fixReady.length,
      p01: fixReady.filter(r => r.priority === 'P0' || r.priority === 'P1').length,
      fix_proposed: fixProposed.length,
    },
    decisions_pending: {
      total: decisions.length,
      p1: decisions.filter(r => r.priority === 'P1').length,
    },
    questions_stale_2d: rows.filter(
      r => r.type === 'question' && !r.has_maintainer_response && r.age_business_days > 2
    ).length,
    close_candidates: {
      total: closeCands.length,
      median_age: Math.round(median(closeCands.map(r => r.age_days))),
    },
    p0_open: p0.length,
    needs_repro_14d: rows.filter(r => isWaiting(r) && r.age_days > 14).length,
    sla: {
      triage_2bd_breach: rows.filter(r => r.type === null && r.age_business_days > 2).length,
      reply_2bd_breach: rows.filter(r => r.reporter_replied && (r.reply_wait_days ?? 0) > 2).length,
      p0_7d_breach: p0.filter(r => r.age_days > 7).length,
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

  // Tier names repeat across groups (e.g. in-progress, close-candidates), so bucket
  // by spec identity, not name.
  const bySpec = new Map<TierSpec, IssueRow[]>(TIER_SPECS.map(s => [s, []]));
  for (const r of rows) {
    const spec = TIER_SPECS.find(t => t.test(r))!;
    bySpec.get(spec)!.push(r);
  }

  const groups: IssueTierGroup[] = GROUPS.map(g => ({
    name: g.name,
    blurb: g.blurb,
    tiers: TIER_SPECS.filter(s => s.group === g.name)
      .map(s => ({ name: s.name, blurb: s.blurb, issues: bySpec.get(s)!.sort(s.sort ?? ageDesc) }))
      .filter(t => t.issues.length > 0),
  })).filter(g => g.tiers.length > 0);

  return {
    lastUpdated: new Date().toISOString(),
    summary: computeSummary(rows),
    groups,
  };
}
