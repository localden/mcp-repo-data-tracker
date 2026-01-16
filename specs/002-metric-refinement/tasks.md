# Metric Refinement Tasks

## Phase 1: Audit Current Metrics

- [ ] Map existing metrics.json fields to 3 As framework
- [ ] Identify metrics that fail actionability test
- [ ] Identify metrics missing auditability documentation
- [ ] Assess accessibility of current dashboard presentation

## Phase 2: Add Missing Metrics

See [new-metrics.md](./new-metrics.md) for full specifications.

### Phase 2a: Easy (Data Already Available)
- [ ] Label Coverage % - compute from existing issue data
- [ ] Code Review Rate - compute from existing PR review data
- [ ] PR Rejection Rate - compute from existing PR data
- [ ] Bot Activity Rate - filter existing comment/review data

### Phase 2b: Medium (Add Query Fields)
- [ ] Release Frequency - add releases query to aggregator
- [ ] Average Reviews per PR - aggregate existing review counts
- [ ] Time to Close (issues) - compute from existing timestamps
- [ ] Commit Frequency Trend - add commit history query

### Phase 2c: Complex (New Collection Logic)
- [ ] Bus Factor - analyze commit author distribution (HIGH PRIORITY)
- [ ] Elephant Factor - fetch user organizations (HIGH PRIORITY)
- [ ] Contributor Retention Rate - cross-period analysis (HIGH PRIORITY)
- [ ] Documentation Change Rate - file path analysis
- [ ] Maintainer Response Distribution - cross-reference with maintainers

### External Integrations
- [ ] OpenSSF Scorecard - fetch scores via API or BigQuery

## Phase 3: Improve Auditability

- [ ] Document calculation methodology for each metric
- [ ] Add data source transparency (API endpoints used)
- [ ] Implement validation checks for data quality
- [ ] Create reproducibility guide

## Phase 4: Improve Accessibility

- [ ] Add threshold indicators (🟢🟡🟠🔴) to dashboard
- [ ] Add trend charts for all key metrics
- [ ] Create "What can I do?" guidance for each metric
- [ ] Add interpretation notes and caveats

## Phase 5: Integration

- [ ] Integrate OpenSSF Scorecard data
- [ ] Link to CNCF DevStats patterns where applicable
- [ ] Consider CHAOSS badge/certification

## References

- [Metric Refinement Spec](./metric-refinement-spec.md)
- [CHAOSS Practitioner Guides](https://chaoss.community/kb-metrics-and-metrics-models/)
- [OpenSSF Scorecard Checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md)
