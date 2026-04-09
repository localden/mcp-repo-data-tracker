---
name: slack-snapshot
description: Generate a Slack-ready weekly health digest for tracked SDK repos — issues, PRs, downloads, trends, and anomaly callouts
---

# slack-snapshot

Produces a Slack-mrkdwn weekly digest covering every repo in `data/repos.json`: download trends (WoW), open-issue deltas, triage backlog, response/review latency, and a "Needs attention" block of rule-driven anomalies.

## When to use

- User asks for the weekly SDK health post / Slack snapshot / repo digest.
- User wants a copy-pasteable Slack message summarising tracker state.

## Arguments

When invoked as `/slack-snapshot [format] [url]`:
- `format` — `mrkdwn` (default) or `svg`
- `url` — dashboard link for the footer (e.g. an internal go-link)

Map these to the script flags below. If no `url` argument is given, the script reads `DIGEST_DASHBOARD_URL` from the environment, then falls back to the public GitHub Pages URL.

## Steps

1. Run the helper script (it locates the repo via `__dirname`, so cwd does not matter):

   ```bash
   node .claude/skills/slack-snapshot/generate.mjs [--format mrkdwn|svg] [--dashboard-url <url>]
   ```

   - `--format svg` emits a self-contained status card with per-SDK tiles and 14-day sparklines; redirect to a file (`> digest.svg`) and attach/upload to Slack.
   - `--dashboard-url <url>` overrides the footer link (takes precedence over `DIGEST_DASHBOARD_URL`).

2. The script writes to **stdout** (mrkdwn text, or an SVG document when `--format svg`). It auto-detects whether this is the ANT or MCP tracker variant from the metrics schema and adapts column headers / anomaly rules accordingly. Missing data renders as `—`; the script never throws on absent fields.

3. Return the stdout verbatim as the message body. If the user asked you to post it, send it to the requested Slack channel; otherwise just print it for copy-paste.

## Notes

- WoW deltas compare the most-recent snapshot against the one ~7 days prior in `data/repos/<owner>/<repo>/snapshots/`.
- Repos without a package (Go, Java, spec, conformance) show `—` for downloads and sort last alphabetically.
- The "Needs attention" block is omitted entirely when no anomaly rule fires.
