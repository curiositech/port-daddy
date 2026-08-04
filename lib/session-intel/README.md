# session-intel — coordination training ledger (WS-3)

Mines **real** port-daddy multi-agent history for collaboration **hits & misses**
and appends them to a permanent, append-only ledger that is both (a) training
material and (b) the source of a ranked, actionable coordination-improvement list.

Part of the **Session Intelligence** program (`docs/roadmap/session-intelligence-program.md` — not yet shipped on this branch; lands via PR #1585) <!-- cite-exempt -->, workstream **WS-3**. Plain node-runnable CommonJS (`.js`) — no framework, no build.

## Hard rules baked in

- **NO keyword-based NLP.** Every hit/miss verdict is derived from **structured
  signals** — claim windows, note `type` fields, session lifecycle status,
  timestamps — never by scanning note body text for words. (If a genuine semantic
  judgement were ever needed it would be a budget-capped cheap-tier model call via
  the `~/.claude/wf-monitor/milestone-cache.js` pattern; round 1 needs none.)
- **Redaction at ingest.** The ledger is append-only and pd notes are immutable, so
  a secret in a stored excerpt would be permanent. `redact.js` strips API keys,
  tokens, JWTs, emails, and absolute home paths **before** anything is written;
  the ledger additionally refuses to persist an excerpt still carrying a raw
  `content` field. Excerpts store redacted text + a one-way `sha256` of the raw.

## Detectors (`miner.js`)

| kind | verdict | structural signal |
|---|---|---|
| `claim-conflict` | miss | two sessions hold **time-overlapping** claims on one file (region overlap → high severity; a bridging handoff/takeover note → coordinated/low) |
| `abandoned` | miss | session lifecycle `status == 'abandoned'`; unreleased claims + later re-pickup → high |
| `handoff` | hit | a note of `type` handoff/takeover, then a later claim by a **different** session on the handed-off file |
| `duplicate-work` | miss | two sessions edit one file **in sequence** within 48h with no bridging handoff note |
| `note-hygiene` | hit/miss | did a scope note precede the session's first claim? |

Each ledger entry: `{ key, kind, verdict, severity, observation, excerpt(redacted),
suggestedChange, signals, refs, createdAt }`. `key` is deterministic (derived from
refs, not a clock) so re-mining is idempotent — the ledger never clobbers.

## Modules

- `redact.js` — ingest-time secret/PII redaction (structured token grammars).
- `data-source.js` — read-only normaliser from a daemon SQLite store or a JSON snapshot.
- `miner.js` — pure detectors (records in → entries out).
- `ledger.js` — append-only JSONL store, idempotent, redaction-guarded.
- `suggestions.js` — the suggestibility pipeline: aggregate misses → ranked build items.
- `cli.js` — proof surface (`mine` / `report` / `sources`).
- `coordination-ledger.selftest.js` — 47 assertions: synthetic fixtures for every
  detector, a planted-secret redaction guard, append-only idempotency, and a **real
  slice** mined from this machine's fleet history.

## Usage

```bash
node lib/session-intel/cli.js sources                    # list discoverable daemon stores
node lib/session-intel/cli.js mine   [--db <path>] [--project port-daddy] [--limit N] [--ledger <path>]
node lib/session-intel/cli.js report [--ledger <path>] [--top N]
node lib/session-intel/coordination-ledger.selftest.js   # run the selftest
```

Default ledger: `~/.port-daddy/session-intel/coordination-ledger.jsonl`
(override with `--ledger` or `PD_SESSION_INTEL_LEDGER`).

## Not in this round

**WS-4 (fine-tuning dataset export) is intentionally out of scope here** and is not
stubbed. See the `TODO(WS-4)` in `cli.js`: turning ledger entries into a deduped,
PII-swept instruction/response dataset with a dataset card belongs to WS-4 and is
gated on WS-3 ledger volume clearing a quality bar. It must not be faked.
