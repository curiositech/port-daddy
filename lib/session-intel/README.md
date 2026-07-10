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
- **Harness-artifact sentinels** — many `is_error` results are agent-vs-HARNESS
  friction, not the agent breaking through a real problem. These are dropped
  (never counted as a failure a later success resolves). Each is a VERBATIM,
  machine-emitted framework/tooling sentinel — the same class of structured
  signal as `is_error`, **not** natural-language content. Filtered classes:
  - `cancelled` — `<tool_use_error>Cancelled: …` / "Interrupted by user" /
    aborted parallel-tool batch.
  - `edit-policy` — "File has not been read yet. Read it first",
    "String to replace not found in file", "File has been modified since read",
    tool "File does not exist. Note: your current working directory …".
  - `guard-block` — "Isolation guard:", "This session is now isolated in",
    "Coordination Guard: ENFORCE", "No active session found",
    "Port Daddy sessions refuse the main Git worktree",
    "refused by Port Daddy coordination guard", "Already in a worktree session".
  - `model-unavailable` — "… is temporarily unavailable, so auto mode cannot
    determine the safety of &lt;Tool&gt;".
  - `permission-denied` — "Permission for this action was denied by the Claude
    Code auto mode classifier", "The user doesn't want to proceed with this tool
    use", "This command requires approval", `<tool_use_error>Blocked:`.
  - `tool-input-error` — `<tool_use_error>InputValidationError:`,
    "No such tool available:".

  A plain `Exit code 1` + traceback (a REAL command failure) matches none of
  these and stays counted. See `classifyHarnessArtifact()` for the exact list.

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

## Honest yield

Filtering the harness-artifact classes above is what makes the arc count
trustworthy. On a 40-session slice of this machine: raw `is_error` results
included **~89% harness friction** (read-first-before-edit walls, isolation /
coordination-guard blocks, model-availability blips, permission gates). After
filtering, `detect-eureka-arcs.js --limit 40 --count` reports **3 genuine arcs**
(a Python build script that failed with a traceback then patched 36 slides; a
vhs probe build that failed to parse then rendered; a `gh pr checks` exit-code
flip). Before this filter the same slice reported 37 — almost all noise.

## Known limitations (honest)

- Similarity is lexical (token Jaccard). Semantically-equivalent commands with
  different wording won't cluster. Good enough for round 1's precision goal.
- The sentinel list is curated from observed transcripts; a new harness message
  class would need adding to `HARNESS_SENTINELS`. It is matched verbatim (fixed
  framework strings), never inferred from prose.
- `gh pr checks` / CI-poll exit-code flips are counted as arcs (a real exit-code
  transition). They are genuine breakthroughs in the structural sense but may
  not be *skill-adding* — that judgment is exactly what round-2's cheap-model
  annotation decides.

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
