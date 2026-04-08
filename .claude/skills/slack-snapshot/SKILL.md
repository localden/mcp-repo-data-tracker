---
name: slack-snapshot
description: Generate a Slack-ready weekly health digest for tracked SDK repos — issues, PRs, downloads, trends, and anomaly callouts
---

# slack-snapshot

Produces a Slack-mrkdwn weekly digest covering every repo in `data/repos.json`: download trends (WoW), open-issue deltas, triage backlog, response/review latency, and a "Needs attention" block of rule-driven anomalies.

## When to use

- User asks for the weekly SDK health post / Slack snapshot / repo digest.
- User wants a copy-pasteable Slack message summarising tracker state.

## Steps

1. Run the helper script from the repo root:

   ```bash
   node .claude/skills/slack-snapshot/generate.mjs
   ```

   Optional flag: `--dashboard-url <url>` to override the footer link.

2. The script writes Slack mrkdwn to **stdout**. It auto-detects whether this is the ANT or MCP tracker variant from the metrics schema and adapts column headers / anomaly rules accordingly. Missing data renders as `—`; the script never throws on absent fields.

3. Return the stdout verbatim as the message body. If the user asked you to post it, send it to the requested Slack channel; otherwise just print it for copy-paste.

## Notes

- WoW deltas compare the most-recent snapshot against the one ~7 days prior in `data/repos/<owner>/<repo>/snapshots/`.
- Repos without a package (Go, Java, spec, conformance) show `—` for downloads and sort last alphabetically.
- The "Needs attention" block is omitted entirely when no anomaly rule fires.
