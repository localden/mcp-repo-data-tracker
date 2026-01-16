# Metric Refinement Specification: The 3 As Framework

## Overview

This specification defines a framework for ensuring that all open-source project health metrics are **Actionable**, **Auditable**, and **Accessible** (the 3 As). The goal is to move beyond vanity metrics toward measurements that drive meaningful improvements in project health.

## Research Summary

This specification is informed by research into how major open-source organizations and academic research define and measure project health:

| Source | Focus Area | Key Contribution |
|--------|-----------|------------------|
| [CHAOSS](https://chaoss.community/) | Community Health Analytics | Metrics models, practitioner guides, working groups |
| [OpenSSF Scorecard](https://github.com/ossf/scorecard) | Security Health | 21 automated security checks with 0-10 scoring |
| [CNCF](https://contribute.cncf.io/maintainers/community/project-health/) | Project Graduation | Maturity criteria for sandbox→incubating→graduated |
| [Apache Maturity Model](https://community.apache.org/apache-way/apache-project-maturity-model.html) | Project Governance | 7 categories with pass/fail criteria |
| [Libraries.io SourceRank](https://libraries.io/) | Dependency Quality | Weighted scoring for package health |
| [Academic Research](https://ieeexplore.ieee.org/document/9474775/) | Sociotechnical Analysis | 107 health characteristics across 15 themes |

## The 3 As Framework

Every metric we track must satisfy all three criteria:

### 1. Actionable

A metric is **actionable** when it directly informs what a maintainer or contributor can do to improve project health.

**Characteristics of Actionable Metrics:**
- Has a clear target or threshold (not just "higher is better")
- Maps to specific remediation steps
- Can be improved through deliberate action
- Shows cause-and-effect relationships

**Examples:**

| Metric | Actionable | Why/How |
|--------|------------|---------|
| Time to First Response | ✅ Yes | Maintainers can triage faster, set up response bots, or add maintainers |
| GitHub Stars | ❌ No | No clear action to improve; influenced by external factors |
| Issues Without Label | ✅ Yes | Can be fixed by labeling; indicates triage backlog |
| Code Coverage % | ✅ Yes | Write more tests for uncovered paths |
| Bus Factor | ✅ Yes | Mentor new contributors, document tribal knowledge |

**CHAOSS Practitioner Guides** provide actionable frameworks:
- **Responsiveness Guide**: How to improve first response times
- **Contributor Sustainability Guide**: How to reduce bus factor risk
- **Sunsetting Guide**: How to gracefully end a project

### 2. Auditable

A metric is **auditable** when its data source, calculation method, and historical values can be independently verified.

**Characteristics of Auditable Metrics:**
- Data source is transparent and accessible
- Calculation methodology is documented
- Historical data is preserved for trend analysis
- Results are reproducible given the same inputs

**Auditability Requirements:**

| Requirement | Implementation |
|-------------|----------------|
| **Source Transparency** | Document exact API endpoints and queries used |
| **Methodology Documentation** | Publish calculation formulas with edge case handling |
| **Data Retention** | Keep daily snapshots for trend verification |
| **Reproducibility** | Anyone with API access can verify current values |

**Example: Time to First Maintainer Response**

```
Data Source: GitHub GraphQL API - issue/PR comments
Calculation:
  1. Filter comments to maintainers only (from maintainers.json)
  2. Exclude author's own comments
  3. Exclude bot comments (*[bot] pattern)
  4. Take MIN(comment.createdAt) - issue.createdAt
Stored: metrics.json → issues.response_time.median_hours
Verification: Re-run aggregation script; compare with stored value
```

**OpenSSF Scorecard's Approach to Auditability:**
- All checks documented in [checks.md](https://github.com/ossf/scorecard/blob/main/docs/checks.md)
- Weekly scans published to BigQuery public dataset
- Score breakdown available for each check
- Acknowledges limitations: "low scores don't definitively indicate risk due to detection coverage gaps"

### 3. Accessible

A metric is **accessible** when it can be understood by its intended audience without specialized knowledge.

**Characteristics of Accessible Metrics:**
- Has intuitive meaning (or clear explanation)
- Uses familiar units (hours, percentages, counts)
- Provides context for interpretation
- Offers multiple levels of detail (summary → drill-down)

**Accessibility Levels:**

| Level | Audience | Example Presentation |
|-------|----------|---------------------|
| **Glanceable** | Casual visitor | "Response time: 8h median" with ✅/⚠️/❌ indicator |
| **Informative** | Potential contributor | Trend chart with comparison to similar projects |
| **Analytical** | Maintainer | Full distribution (p50/p90/p95), breakdown by label |
| **Technical** | Researcher | Raw data access, methodology documentation |

**CNCF's Approach to Accessibility:**
- [DevStats dashboards](https://devstats.cncf.io/) provide visual exploration
- Contextual notes: "every project is a little different"
- Explicit guidance on interpretation vs. raw numbers

---

## Metric Categories

Based on research synthesis, we organize metrics into six categories:

### Category 1: Responsiveness

**Purpose:** Measure how quickly the project responds to external contributions and questions.

| Metric | Definition | Actionable | Auditable | Accessible |
|--------|------------|------------|-----------|------------|
| Time to First Response | Time from issue/PR creation to first maintainer comment | ✅ Target: <48h | ✅ GitHub API | ✅ Hours |
| Time to First Review | Time from PR creation to first maintainer review | ✅ Target: <72h | ✅ GitHub API | ✅ Hours |
| Issues Without Response | Count of issues open >7d without maintainer comment | ✅ Triage queue | ✅ Snapshot | ✅ Count |
| PR Review Backlog | Count of PRs awaiting review >7d | ✅ Review queue | ✅ Snapshot | ✅ Count |

**Thresholds (from CHAOSS recommendations):**
- 🟢 Excellent: <24h median response
- 🟡 Good: 24-72h median response
- 🟠 Needs Attention: 72h-7d median response
- 🔴 Critical: >7d median response

### Category 2: Contributor Sustainability

**Purpose:** Measure the project's resilience to contributor changes.

| Metric | Definition | Actionable | Auditable | Accessible |
|--------|------------|------------|-----------|------------|
| Bus Factor | Minimum contributors making 50% of commits | ✅ Mentor more | ✅ Git history | ✅ Count |
| Elephant Factor | Minimum orgs making 50% of commits | ✅ Diversify | ✅ Git history | ✅ Count |
| Active Contributors (30d) | Unique contributors in last 30 days | ✅ Onboarding | ✅ Git history | ✅ Count |
| First-Time Contributors (30d) | New contributors in last 30 days | ✅ Onboarding | ✅ Cumulative set | ✅ Count |
| Contributor Retention | % of contributors active >3 months | ✅ Engagement | ✅ Git history | ✅ Percentage |

**Thresholds:**
- 🟢 Healthy: Bus factor ≥3, Elephant factor ≥2
- 🟡 At Risk: Bus factor 2, or single-org dominated
- 🔴 Critical: Bus factor 1 (single point of failure)

### Category 3: Velocity & Throughput

**Purpose:** Measure the project's ability to process contributions and release updates.

| Metric | Definition | Actionable | Auditable | Accessible |
|--------|------------|------------|-----------|------------|
| PR Merge Rate | PRs merged per week (rolling average) | ✅ Process improvements | ✅ GitHub API | ✅ Count/week |
| Issue Close Rate | Issues closed per week (rolling average) | ✅ Triage process | ✅ GitHub API | ✅ Count/week |
| Time to Merge | Median time from PR open to merge | ✅ Review process | ✅ GitHub API | ✅ Days |
| Release Frequency | Releases per quarter | ✅ Release process | ✅ GitHub API | ✅ Count/quarter |

**Interpretation Note:** Velocity metrics must be contextualized. A mature, stable project may have lower velocity than an early-stage project—this is healthy, not concerning.

### Category 4: Quality & Security

**Purpose:** Measure the project's commitment to code quality and security.

| Metric | Definition | Actionable | Auditable | Accessible |
|--------|------------|------------|-----------|------------|
| OpenSSF Scorecard | Aggregate security score (0-10) | ✅ Fix checks | ✅ Public data | ✅ Score |
| Code Review Rate | % of PRs with review before merge | ✅ Enforce reviews | ✅ GitHub API | ✅ Percentage |
| Reopen Rate | % of issues/PRs reopened after close | ✅ Root cause analysis | ✅ Timeline events | ✅ Percentage |
| Security Policy | Has SECURITY.md with disclosure process | ✅ Create policy | ✅ File check | ✅ Yes/No |

**OpenSSF Scorecard Checks (21 total):**
See [full check list](https://github.com/ossf/scorecard/blob/main/docs/checks.md) for detailed scoring.

Key checks:
- Branch-Protection (0-10 tiered)
- Code-Review (penalizes unreviewed merges)
- Vulnerabilities (OSV database)
- Maintained (commit frequency)
- Contributors (organizational diversity)

### Category 5: Community Health

**Purpose:** Measure the health of the contributor and user community.

| Metric | Definition | Actionable | Auditable | Accessible |
|--------|------------|------------|-----------|------------|
| Maintainer Diversity | % of maintainer responses by role | ✅ Role distribution | ✅ Access repo | ✅ Breakdown |
| Label Coverage | % of issues with labels | ✅ Triage process | ✅ GitHub API | ✅ Percentage |
| Stale Issues | Issues with no activity >60d | ✅ Close or revive | ✅ Snapshot | ✅ Count |
| Documentation Updates | Doc changes per release | ✅ Doc process | ✅ Git history | ✅ Count |

### Category 6: Adoption & Growth

**Purpose:** Measure external indicators of project adoption (with caveats).

| Metric | Definition | Actionable | Auditable | Accessible |
|--------|------------|------------|-----------|------------|
| Stars (trend) | Star growth rate, not absolute count | ⚠️ Limited | ✅ GitHub API | ✅ Δ/month |
| Forks (trend) | Fork growth rate | ⚠️ Limited | ✅ GitHub API | ✅ Δ/month |
| Dependent Projects | Projects depending on this one | ⚠️ Limited | ✅ deps.dev | ✅ Count |

**Caveat:** These are **lagging indicators** with limited actionability. Include for context but don't over-emphasize.

---

## Implementation Recommendations

### Metric Selection Criteria

When adding a new metric, evaluate against the 3 As:

```
Metric Checklist:
□ Actionable: What specific action can a maintainer take to improve this?
□ Auditable: Can we document the exact data source and calculation?
□ Accessible: Will the target audience understand what this means?

If any answer is unclear → don't add the metric yet
```

### Dashboard Design Principles

1. **Lead with actionable insights**, not raw numbers
2. **Show trends**, not just snapshots
3. **Provide context** (comparisons, thresholds, explanations)
4. **Enable drill-down** from summary to detail
5. **Acknowledge limitations** (e.g., "Bot activity excluded")

### Data Quality Requirements

| Requirement | Implementation |
|-------------|----------------|
| Freshness | Update metrics every 6 hours |
| Retention | Keep daily snapshots for 90 days, then monthly |
| Transparency | Document all filters, exclusions, and edge cases |
| Validation | Automated checks for data anomalies |

---

## Comparison with Existing Frameworks

### CHAOSS Metrics Models

CHAOSS organizes metrics into working groups:
- **Common Metrics**: Cross-cutting metrics used by multiple groups
- **Diversity & Inclusion**: Demographic and participation diversity
- **Evolution**: How projects change over time
- **Value**: Business and community value
- **Risk**: Security and sustainability risks

Our 3 As framework is complementary—it provides evaluation criteria for which CHAOSS metrics to prioritize.

### Apache Maturity Model

Apache uses 7 categories with pass/fail criteria:
- Code, Licenses, Releases, Quality, Community, Consensus, Independence

This is designed for graduation decisions, not ongoing health monitoring. We can map their criteria to ongoing metrics.

### CNCF Graduation Criteria

CNCF requires:
- Healthy number of committers from multiple organizations
- Substantial ongoing flow of commits
- Security audit completion
- Documented governance

Our metrics directly support demonstrating these criteria.

### OpenSSF Scorecard

Focuses specifically on security with automated checks:
- 21 checks with 0-10 scores
- Weekly scans of 1M critical projects
- Public BigQuery dataset

We should integrate Scorecard scores as our primary security metric.

---

## References

### Academic Research

- Link, G., Germonprez, M., & Goggins, S. (2021). [Open Source Community Health: Analytical Metrics and Their Corresponding Narratives](https://ieeexplore.ieee.org/document/9474775/). IEEE/ACM SoHeal.
- Manikas, K. (2016). [How to characterize the health of an Open Source Software project?](https://dl.acm.org/doi/fullHtml/10.1145/3555051.3555067). ACM OpenSym.
- [Assessing Open Source Project Health](https://aisel.aisnet.org/cgi/viewcontent.cgi?article=1486&context=amcis2018). AMCIS 2018.

### Industry Standards

- [CHAOSS Metrics](https://chaoss.community/kb-metrics-and-metrics-models/)
- [OpenSSF Scorecard Checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md)
- [CNCF Project Health](https://contribute.cncf.io/maintainers/community/project-health/)
- [Apache Maturity Model](https://community.apache.org/apache-way/apache-project-maturity-model.html)
- [CHAOSScon 2025 Takeaways](https://blog.okfn.org/2025/02/11/chaosscon-2025-key-takeaways-on-open-source-health-and-metrics/)

### Tools

- [GrimoireLab](https://chaoss.github.io/grimoirelab/) - CHAOSS analytics platform
- [Augur](https://github.com/chaoss/augur) - CHAOSS data collection
- [OpenSSF Scorecard](https://scorecard.dev/) - Security scoring
- [deps.dev](https://deps.dev/) - Dependency health
- [CNCF DevStats](https://devstats.cncf.io/) - CNCF project dashboards

---

## Open Questions

1. **Weighting**: Should we create a composite "health score" or keep metrics separate?
   - Pro: Single number is more accessible
   - Con: Hides nuance, may not be actionable

2. **Thresholds**: Should thresholds be absolute or relative to project type/size?
   - CNCF approach: "every project is a little different"
   - OpenSSF approach: Fixed thresholds for consistency

3. **Comparative Analysis**: Should we compare against other MCP ecosystem projects?
   - Useful for context but risks unfair comparisons

4. **Sentiment**: Should we incorporate qualitative measures (e.g., issue tone)?
   - CHAOSS has working group on this
   - Complexity vs. value trade-off

---

## Next Steps

1. **Audit current metrics** against 3 As framework
2. **Identify gaps** in current metric coverage
3. **Prioritize additions** based on actionability
4. **Design dashboard** following accessibility principles
5. **Document methodology** for auditability
