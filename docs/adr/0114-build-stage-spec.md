# 0114. Host-Safety Layer — Phase A build spec (`pd safe scan`, the read-only posture audit)

## Status

Proposed (build spec — the concrete, file-named slice the build workflow executes for
Phase A of [ADR-0088](0088-host-safety-layer.md)).

## Context

[ADR-0088](0088-host-safety-layer.md) decided `pd safe`, the host-safety layer. Phase A is
the shippable-now, 100% read-only, zero-Apple-entitlement slice: `pd safe scan` — a
one-shot posture audit emitting a 0–100 score and a concrete *"what could an agent running
as you read right now"* blast-radius report. This spec names the exact components, files,
the test plan (the daemon runs on **`bun:sqlite`** — Bun's built-in SQLite binding; the
trust ledger and any daemon-resident state must be tested under it, not jest's
`better-sqlite3`, per the repo's "regression test under the REAL runtime" rule), and what
each later phase needs from this slice.

Nothing in Phase A is privileged or destructive. It reads files the operator's own UID can
already read, runs unprivileged trust CLIs, and writes only its own report + baseline +
ledger. It composes with — never forks — `lib/coast-guard.ts`.

## Phase A components (build these, in this order)

All `lib/safe/*` modules below are **proposed** — this build spec directs the build
workflow to create them; none exist yet. <!-- cite-exempt: proposed modules, created by this Phase A slice -->

### A1. Secret-at-rest scanner — `lib/safe/secret-scanner.ts` (proposed)

The structured-format + entropy detector. NO keyword-NLP classifier.

- **Rule corpus:** vendor the gitleaks MIT rule pack to `lib/safe/rules/gitleaks-rules.json` (proposed)
  (a build-time conversion of `config/gitleaks.toml`; record the upstream commit + a
  `refreshed-at` date — it is a maintained dependency, not a constant). Each rule: `id`,
  `regex`, optional per-rule `entropy` floor.
- **Detectors:** (1) structured-format regex match (the verdict), (2) Shannon entropy
  `H = -Σ p(c)·log₂ p(c)` fallback for unknown blobs — base64 floor 4.5, hex 3.0, length
  ≥ 20, **only** fired on a known cred path or alongside a structured anchor so entropy is
  never the sole verdict. Decode `~/.docker/config.json` `auths.*.auth` base64 and scoped
  fields before matching (bounded decode depth), but do not blanket-decode (inflates
  entropy false positives).
- **Hiding-spot list** (seeded from `defaultCrownJewels()` in `lib/coast-guard.ts`, then
  extended): `**/.env` + `.env.*` under `$HOME` and registered workdirs, `~/.aws/credentials`,
  `~/.config/gh/hosts.yml`, `~/.netrc`, `~/.npmrc`, `~/.pip/pip.conf`,
  `~/.docker/config.json`, `~/.ssh/*` PEM, `~/.zsh_history`/`~/.bash_history`, `.mcp.json`,
  `~/.cursor/mcp.json`, Claude config.
- **Output per finding:** `{ path, line, ruleId, last4, entropy, verified: null }` — the
  raw value is **never** emitted or logged.

### A2. Baseline triage store — `lib/safe/baseline.ts` + `.pd-secrets-baseline.json` (proposed)

The detect-secrets model, shipped WITH the scanner (without it the score is noise on first
run). A committed JSON of triaged findings keyed by a stable fingerprint
(`hash(ruleId + path + last4)`), each with state `accepted | rotated | false-positive`. A
re-scan surfaces only NEW (un-fingerprinted) findings. `pd safe baseline accept <id>`
writes a triage entry. The score reads `accepted`/`false-positive` as suppressed.

### A3. Crown-jewel permission audit — `lib/safe/perms-audit.ts` (proposed)

For each crown-jewel path: `stat` the mode and flag world/group-readable secrets
(`~/.ssh`, `~/.aws`, `~/.gnupg`), and call `coastGuardStatus()` (`lib/coast-guard.ts`) to
report whether the deny-list is actually in force. Read-only; the auto-fix that `chmod`s
these is Phase A's only *write*, and it is opt-in (`pd safe fix --auto`), reversible, and
records the prior mode.

### A4. Binary trust scanner — `lib/safe/binary-trust.ts` (proposed)

Per binary (scope: running processes + `~/Downloads` + `npm`/`pip` global bins):

- `codesign --verify --deep --strict` + `codesign -dv --verbose=4` (Authority chain,
  `TeamIdentifier`, `CDHash`, ad-hoc flag) + `codesign --check-notarization`.
- `xattr -p com.apple.quarantine` for provenance — **but treat missing quarantine as
  UNKNOWN, never SAFE** (curl|bash, scp, git-clone, npm/pip leave no quarantine xattr; that
  is the dangerous path). Lean on signing + notarization, not provenance.
- Use `codesign`/SecCode for bare CLI binaries; reserve `spctl -a -t exec` for `.app`
  bundles only (it misreports on standalone CLI executables — the common agent/MCP shim
  shape).
- **Classify:** `platform | dev-id-notarized | dev-id-unnotarized | ad-hoc | unsigned`,
  plus a path-origin tag (`~/Downloads`, `/tmp`, npm/pip shim).

### A5. Binary trust ledger — `lib/safe/trust-ledger.ts` (proposed) (daemon-resident, `bun:sqlite`)

The durable spine both the scan and every future enforcement phase read from. SQLite table
keyed by `cdhash` (sha256 fallback for unsigned): `path(s)`, `team_id`, `signing_id`,
`signer_chain`, `notarized`, `adhoc`, `quarantine_origin`, `first_seen`, `last_seen`,
`verdict (allow|prompt|deny)`, `source (user|santa-sync|default)`. A Santa-style precedence
resolver (`cdhash > signing_id > team_id`). Cache by `(path, cdhash)` so a re-scan does not
re-shell `codesign` for unchanged binaries.

### A6. Egress snapshot — `lib/safe/egress-snapshot.ts` (proposed)

A read-only point-in-time map: `nettop -P -m route -l 1` (per-PID host + byte counters, **no
sudo**) joined with `lsof -i -nP` (own-UID sockets) → `{ pid, binary, remoteHost, bytes }`,
correlated to PD's spawn registry so a flow attributes to a known agent/sortie, not a bare
PID. Volumetric + destination only (TLS bodies opaque); labeled EVIDENCE, not enforcement.

### A7. MCP / skill supply-chain inventory — `lib/safe/mcp-inventory.ts` (proposed)

Enumerate configured MCP servers across `.mcp.json`, `~/.cursor/mcp.json`, and Claude
config; flag any server whose `command` is an unpinned `npx`/`uvx` fetch (the
typosquat / tool-poisoning vector) — structured field inspection of the `command` array, not
NLP.

### A8. Scoring + report + receipt — `lib/safe/posture-report.ts` (proposed)

Aggregate A1–A7 into a 0–100 posture score (deductions for: NEW plaintext secrets,
world-readable crown jewels, Coast Guard off, unsigned/un-notarized running binaries,
unpinned MCP fetches, flows to non-allowlisted hosts) plus the blast-radius list. Map the
score to a Safe Room state (green/amber/red) where **green = "cooperative-case sensors
clear," never "sandboxed."** Every report footer echoes `HONEST_LIMITS` (`lib/coast-guard.ts`)
verbatim.

### A9. CLI surface — `bin/port-daddy-cli.ts` + completions + manifest

Add the `pd safe` verb group: `pd safe scan` (default, JSON `--json` or rich table),
`pd safe baseline accept <id>`, `pd safe fix --auto` (the opt-in reversible `chmod` only).
Per the repo's "adding a CLI command trips 6 gates" rule, this slice MUST also update:
bash/zsh/fish completions, `features.manifest.json` (MCP-parity: a routed feature an agent
could use gets a real MCP tool — add `safe_scan` to the MCP surface), the permission-tier
`TIER_REGISTRY`, `scripts/e2e-compiled-cli-surface.sh`, and use `DEFAULT_DAEMON_PORT` (no
literal port).

### A10. MCP tool — `mcp/` `safe_scan`

A read-only MCP tool returning the structured posture report (score + findings with
`last4` only, never raw values) so an agent is a first-class consumer of its own safety
posture (no MCP_EXEMPT cop-out — this is agent-useful and read-only).

### A11. Safe Room posture light — FleetBar menu-bar item + pd-console pane

A single legible green/amber/red light using pd-console's existing OKLCH / ICS-flag badge
system, click-through to the full scan report. **Visual-artifacts rule applies:** the PR
MUST carry a screenshot AND a motion artifact (GIF) of the light in all three states +
the report pane in its Test Plan before merge — no `visual-exempt`. Read the current
palette from `website-v2/src/styles/tokens.semantic.css` / pd-console theme; do not hardcode
hex.

## Test plan

All daemon-resident state (the trust ledger A5, any cached scan state) is tested under
**`bun:sqlite`** with the bun daemon BOOTED and the route smoked — not green-in-jest-only.

- **A1 secret-scanner unit (jest, pure-fn):** fixture dotfiles with each structured format
  (AKIA, ghp_, sk-ant-, AIza, xoxb-, PEM) → asserts exact `ruleId` + `last4`, raw value
  never present in output; high-entropy non-secret (UUID, git SHA, minified-JS blob) →
  asserts NOT flagged (entropy gating works); `~/.docker` base64 `auth` → asserts decoded +
  matched.
- **A2 baseline (jest):** first scan flags N; accept all; re-scan flags 0; inject one NEW
  secret → re-scan flags exactly 1.
- **A4 binary-trust (jest + a real `codesign` shell on a known platform binary like
  `/bin/ls` and a known unsigned fixture):** asserts classification buckets; asserts missing
  quarantine → UNKNOWN not SAFE.
- **A5 trust-ledger (bun:sqlite, daemon runtime):** insert → precedence-resolve
  (`cdhash > signing_id > team_id`); re-scan cache hit avoids a second `codesign` shell;
  schema migration boots clean under the bun daemon.
- **A6/A7 (jest):** `nettop`/`lsof` output parsed defensively (tolerate missing fields);
  unpinned-`npx` MCP entry flagged, pinned one not.
- **A8 scoring (jest):** deterministic score for a fixed fixture set; footer contains the
  exact `HONEST_LIMITS` string.
- **A9 CLI-surface (`scripts/e2e-compiled-cli-surface.sh`):** `pd safe scan --json` parses;
  completions list the verb; `features.manifest.json` parity check passes (no undeclared
  command — the tenderfoot-audit failure mode).
- **A10 MCP smoke (bun daemon BOOTED):** `safe_scan` tool returns a valid report; asserts no
  raw secret in the payload.
- **A11 visual:** Playwright headless capture of the three Safe Room states + report pane;
  screenshot + GIF embedded in the PR Test Plan.

## What later phases need from Phase A

- **Phase B (corral):** A1's findings (path + line) are the corral targets; A2's baseline
  records `rotated` after a corral; the `--staged` guard reuses A1's scanner against
  `git diff --staged`.
- **Phase C (`pd safe watch`):** the A5 trust ledger is the lookup the `eslogger` exec
  stream joins against; A6's socket map is the correlation target for the
  read-dotenv-then-egress tripwire.
- **Phase D (egress):** A6's snapshot becomes the seed of the continuous nettop poller; the
  per-agent allowlist drift flag reads the spawn-registry join A6 establishes.
- **Phase E (enforcement):** the A5 ledger's `verdict` column is exactly what a
  Santa-fronted `AUTH_EXEC` lockdown (E2) authors rules from, and what the
  `NEFilterDataProvider` allowlist (E1) reads; A8's score gates whether the operator is even
  prompted to install a sysext.
- **Phase F (`pd safe attest`):** A8's report is the body the macaroon kernel
  (`core/kernel/pd-anchor`) signs, with the `HONEST_LIMITS` blind-spot enumeration as a
  first-class signed field.

## References

- ADR-0088 — the host-safety layer decision this spec executes (Phase A).
- `lib/coast-guard.ts` — `defaultCrownJewels`/`coastGuardStatus`/`HONEST_LIMITS`; the seed
  + the honesty string Phase A composes with.
- `lib/coast-guard/egress-meter.ts` — the proxy A6's snapshot complements and Phase D
  promotes.
- `lib/secret-env.ts` — `saveManagedSecret`/`withSecretsInChildEnv`; the Phase B corral
  target A1's findings feed.
- `lib/spawner.ts` — the spawn registry A6 joins flows against.
- `bin/port-daddy-cli.ts` — where the `pd safe` verb group is added.
- `features.manifest.json` — the parity manifest A9 must update (no undeclared command).
- `core/kernel/pd-anchor` — the macaroon kernel that signs the Phase F attestation.
- `lib/safe/secret-scanner.ts`, `lib/safe/baseline.ts`, `lib/safe/perms-audit.ts` — proposed Phase A modules. <!-- cite-exempt -->
- `lib/safe/binary-trust.ts`, `lib/safe/trust-ledger.ts`, `lib/safe/egress-snapshot.ts` — proposed Phase A modules. <!-- cite-exempt -->
- `lib/safe/mcp-inventory.ts`, `lib/safe/posture-report.ts` — the Phase A modules to build (proposed; created by this build spec).
- `.pd-secrets-baseline.json`, `lib/safe/rules/gitleaks-rules.json` — the committed baseline + vendored rule corpus to create (proposed). <!-- cite-exempt -->
