# session-intel — Session Intelligence program workstreams

Two plain node-runnable CommonJS workstreams over real port-daddy history —
no framework, no build. Part of the Session Intelligence program
(`docs/roadmap/session-intelligence-program.md`, PR #1585). <!-- cite-exempt -->

---

## WS-3 — coordination training ledger


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

---

## WS-2 — eureka arc detector


Detects **"failure → failure → success" arcs** in Claude Code / Workflow session
transcripts: a tool (usually Bash or a test runner) invoked with the
same-or-similar input that failed one or more times and then succeeded. These
breakthroughs are the candidate **eureka / skill-adding moments** the Session
Intelligence program wants to mine.

## Files

| Path | What |
|------|------|
| `lib/session-intel/eureka-arc-detector.js` | The detector (ESM, plain node — no deps). |
| `lib/session-intel/eureka-arc-detector.selftest.js` | Framework-free selftest (synthetic fixtures + ≥12 real on-disk sessions). |
| `tools/session-intel/detect-eureka-arcs.js` | CLI that scans `~/.claude/projects` and prints arcs as JSON. |

## Run

```bash
# Selftest (asserts, exits non-zero on any failure)
node lib/session-intel/eureka-arc-detector.selftest.js

# Detect arcs across every session on this machine
node tools/session-intel/detect-eureka-arcs.js --pretty

# Sample the 40 biggest transcripts, print a count
node tools/session-intel/detect-eureka-arcs.js --limit 40 --count

# One transcript
node tools/session-intel/detect-eureka-arcs.js --pretty ~/.claude/projects/<slug>/<uuid>.jsonl
```

## What counts as a signal (STRUCTURED ONLY — no keyword NLP)

The detector never scans transcript prose for words like "error"/"fixed"/"pass".
Every signal is structural:

- **`tool_result.is_error`** — the transcript's own boolean error status. A
  non-zero Bash exit or a failed Edit surfaces here. Primary failure signal.
- **Structured exit code** (`exit_code`/`returncode`/…) when a harness records
  one — secondary signal, read from the field, never parsed from text.
- **Structural input similarity** — two invocations are "the same" when they use
  the same tool and their normalized inputs match (exact) or their token sets
  hit a Jaccard threshold (default 0.6). For Bash the signature is the
  normalized command; for file tools it's the `file_path`. Never a signal-word
  list.
- **Harness-interrupt sentinel** — the harness's own machine-generated
  `<tool_use_error>Cancelled: …</tool_use_error>` / "Interrupted by user"
  envelope marks a call that never actually ran. Those are dropped so a
  cancelled parallel-tool batch can't fabricate or inflate an arc. This matches
  a fixed framework sentinel (the same class of signal as `is_error`), not
  natural-language content.

## Output

Each arc:

```jsonc
{
  "sessionId": "5e670818-…",
  "tool": "Bash",
  "signature": "cd ~/coding/tmp/avatars-deck && python3 build_avatars.py",
  "failCount": 3,                 // genuine failures before the win
  "eurekaBlockIndex": 812,        // transcript block index of the success
  "firstFailBlockIndex": 640,
  "whatChangedDelta": {           // structural diff, last failure → success
    "type": "identical-invocation" | "invocation-changed",
    "added": [ "--fix" ], "removed": [], "note": "…"
  },
  "excerpt": { "lastFailure": "Exit code 1 Traceback …", "success": "36 slides patched …", … },
  "skillAdding": null             // reserved for round 2 (see below)
}
```

`whatChangedDelta.type === "identical-invocation"` means the byte-identical
command succeeded after prior failures — the breakthrough came from external
state the agent changed between runs (fixed a file, installed a dep, a flaky
test settling). `"invocation-changed"` names the tokens added/removed.

## Known limitations (honest)

- **Model-availability blips** (`"…is temporarily unavailable, so auto mode
  cannot determine the safety of Edit"`) are `is_error` results that are really
  infra hiccups, not code failures. Round 1 does **not** filter this class
  (only the unambiguous `<tool_use_error>` sentinel). It can inflate Edit
  `failCount`. Round-2 refinement.
- Similarity is lexical (token Jaccard). Semantically-equivalent commands with
  different wording won't cluster. Good enough for round 1's precision goal.

## Round 2 — NOT built (stub-free TODO)

1. **Semantic "is this skill-adding?" annotation** — for each detected arc, a
   **cheap-tier model** call (reusing the budget-capped cache at
   `~/.claude/wf-monitor/milestone-cache.js` — `MilestoneCache` /
   `computeMilestones`, `MODEL` is the cheap tier) decides whether the
   breakthrough is genuinely worth capturing. `annotateSkillAdding()` is a
   documented placeholder that **throws** so no caller mistakes an
   unimplemented judgment for a real one. Must never be keyword matching.
2. **L3 extraction** — turn a confirmed skill-adding arc into an L3 reasoning
   trace (what the agent tried, why it failed, what changed).
3. **skill-architect drafting** — hand the L3 trace to `skill-architect` to
   draft a candidate SKILL.md.
4. **Model-availability / infra-blip filter** (see limitations).
