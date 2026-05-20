# Daemon golden fixtures

Sampled responses from the live binary `pd` daemon. The CLI tests in
`tests/unit/memory-tiers-cli.test.js` use these to lock the CLI's wire-shape
assumptions against what the daemon actually emits.

If the daemon's response shape changes, re-sample:

```
curl -s http://localhost:9876/salvage/pending?limit=2 \
  | jq '.' > tests/fixtures/daemon-salvage-pending.golden.json
```

The CLI tests do NOT load these files directly — they mock `pdFetch` to return
the same shapes. The fixtures exist to make "what does the daemon actually
emit?" a checked-in, diffable artifact when the next bug like PR #114
finding 1 lands.
