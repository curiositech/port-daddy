# Daemon golden fixtures

Sampled responses from the live binary `pd` daemon. The CLI tests in
`tests/unit/memory-tiers-cli.test.js` use these to lock the CLI's wire-shape
assumptions against what the daemon actually emits.

If the daemon's response shape changes, re-sample:

```bash
# Select stable or a named feature daemon first. `pd use` exports the endpoint
# that daemon actually published, including any collision fallback.
eval "$(pd use stable)"
: "${PORT_DADDY_URL:?pd use did not publish a daemon URL}"
curl -s "${PORT_DADDY_URL}/salvage/pending?limit=2" \
  | jq '.' > tests/fixtures/daemon-salvage-pending.golden.json
```

The CLI tests do NOT load these files directly — they mock `pdFetch` to return
the same shapes. The fixtures exist to make "what does the daemon actually
emit?" a checked-in, diffable artifact when the next bug like PR #114
finding 1 lands.
