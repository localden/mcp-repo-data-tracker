# PR Actionability Classifier

Classifies open SDK PRs into tier→state buckets where a maintainer owes the next move. Writes `data/repos/.../{repo}/actionability.json` (full tier→state→PR tree, rendered by the pulls page) and patches `.summary` into the day's snapshot (for sparklines).

## Provenance

Vendored from `anthropics/dotfiles/users/fweinberger/plugins/mcp-oss-digest/scripts/` at v1.4.0 (dotfiles commit `9edd0588`). Two files:

- `pr-actionable` — the classifier
- `lib/access.py` — maintainer loading

To re-vendor: copy both files, then re-apply the two flags that make it run in GHA (`--maintainers-json`, `--state-dir`) — the dotfiles version assumes a local `~/src/mcp/access` checkout and `~/src/mcp/.automation` state dir.

## Runtime deps

- Python 3.12 (stdlib only)
- `gh` CLI (`GH_TOKEN` env)
- `claude` CLI (`npm install -g @anthropic-ai/claude-code`, `ANTHROPIC_API_KEY` env) — only for LLM phases; `--no-llm` skips them

## Local run

```bash
python3 scripts/pr-actionable \
  --repo typescript-sdk \
  --no-llm \
  --maintainers-json data/maintainers.json \
  --state-dir /tmp/act-state \
  --visr-json /tmp/act-{repo}.json

jq '.summary' /tmp/act-typescript-sdk.json
```
