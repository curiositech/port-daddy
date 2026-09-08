# Durable State, Sandbox, And Supervision Review

Status: work packet for the Agent Harbor binder.

Scope:
  Infrastructure and safety review for official Port Daddy Agent compliance.
  This packet reviews durable state, transcript retention, supervisor integrity,
  sandbox containment, secrets custody, doctor remediation, and acceptance gates.
  It is a docs-only review and makes no code changes.

Source anchors:

- `02-runtime-authority-and-deployment.md`
- `06-security-privacy-billing-and-accounts.md`
- `09-data-model-and-api.md`
- `docs/operations/daemon-and-supervision.md`
- `docs/proposals/official-port-daddy-agent-compliance-plan.md` — authored on `codex/gpui-harness-mux`; will land with that branch (not yet shipped on main)
- `lib/db.ts`
- `lib/sqlite-runtime.ts`
- `scripts/db-consolidate.ts`
- `server.ts`
- `lib/transcripts.ts`
- `lib/transcript-store.ts`
- `lib/transcript-archive.ts`
- `lib/spawner.ts`
- `lib/coast-guard.ts`
- `lib/secret-env.ts`
- `lib/keychain.ts`
- `lib/macaroon/store.ts`
- `routes/secrets.ts`
- `cli/commands/diagnostics.ts`
- `scripts/ci-doctor-gate.sh`
- `tests/unit/db-prod-guard.test.js`
- `tests/unit/transcript-archive.test.js`
- `tests/unit/spawner-transcripts.test.js`
- `tests/unit/coast-guard*.test.js`
- `tests/unit/secrets-routes.test.js`
- `tests/unit/diagnostics-doctor.test.js`

## Executive Verdict

Official Port Daddy Agent compliance is close enough to be concrete, but not
close enough to be admitted on infrastructure trust alone.

The runtime already has strong pieces:

- SQLite initialization enables WAL, a 5 second busy timeout, foreign keys,
  integrity checks, and 0600 database permissions.
- Spawner-backed `fleet_transcripts` are fail-closed under production wiring and
  finalized transcripts are archived to local JSONL by default.
- `pd doctor` has a structured health surface, binary drift checks, launchd
  supervision integrity checks, DB integrity checks, and a compiled-daemon CI
  gate.
- Coast Guard is on by default for subprocess spawns, scrubs raw secrets from the
  child environment, applies OS sandboxing when available, and records honest
  receipts.
- Managed provider secrets are allow-listed, stored through the OS keychain for
  console-entered values, and protected by loopback-only mutation/reveal routes.

The compliance blockers are also specific:

- The canonical database path contract is fragmented. Binder target docs describe
  `~/.port-daddy/daemon.db`, current code defaults to `port-registry.db`, dev
  profiles use `port-daddy.db`, and consolidation targets
  `~/.port-daddy/port-registry.db`.
- WAL exists, but official-agent admission needs an explicit DB-family contract:
  the database, `-wal`, and `-shm` sidecars must migrate, back up, checkpoint, and
  recover as one durable unit.
- Transcript retention is on by default for finalized fleet transcripts, but
  official transcript events still allow nullable `session_id`, have no required
  retention policy id, no hash chain, no JSONL mirror, and no automatic redaction
  in `lib/transcript-store.ts`.
- Launchd supervision integrity is checked, but official-agent admission needs
  that check to become a blocking gate with operator-facing remediation, not just
  a diagnostic that prints shell hints.
- Coast Guard currently contains the read/exfil/spend axis honestly. It does not
  yet contain `write`, `critical`, or `full` scope, destructive git, deploys, DB
  writes, or a malicious same-UID agent. Official coding agents must not treat
  that as full sandbox containment.
- `pd doctor --fix harness` and `pd agent compliance probe` are described in the
  compliance plan, but the current doctor surface is still generic health plus
  agent-runtime wiring. The harness remediation lane must exist before official
  launch can be self-healing.

The rule for the control plane should be simple:

No canonical DB path proof, non-null transcript/session join, local transcript
archive, active supervisor, passing containment harness, keychain-backed secret
custody, and doctor remediation means no official Port Daddy Agent. The UI may
still show the body as `observed`, `sandbox-degraded`, or `unmanaged`.

## Canonical DB Path And WAL

### Current Evidence

Desired binder shape:

- `02-runtime-authority-and-deployment.md` describes a single daemon-owned store
  under `~/.port-daddy/daemon.db`, plus per-harbor ledgers such as
  `harbors/<id>/ledger.sqlite`.
- `09-data-model-and-api.md` expects the daemon to query official Agent Nodes,
  sessions, transcript events, work receipts, control commands, costs, claims,
  files, and governance state from explicit daemon records.

Current code shape:

- `lib/db.ts` resolves the database by explicit override, `PORT_DADDY_DB`, then
  `<resource-root>/port-registry.db`.
- `server.ts` passes `<PORT_DADDY_PREFIX>/port-daddy.db` when a dev profile is
  active; otherwise it falls back through `resolveDbPath()`.
- `lib/daemon-profiles.ts` uses `~/.port-daddy/instances/<label>/port-daddy.db`
  for side-by-side dev daemons.
- `scripts/db-consolidate.ts` treats `~/.port-daddy/port-registry.db` as the
  consolidation destination, while also scanning repo, dist, stable, profile,
  Homebrew opt/var, Cellar, env, and live-open DB paths.
- `lib/db.ts` sets `journal_mode = WAL`, `synchronous = NORMAL`,
  `wal_autocheckpoint = 200`, `busy_timeout = 5000`, and `foreign_keys = ON`.
- `lib/db.ts` chmods real database files to 0600 and warns if WAL mode does not
  stick.
- `tests/unit/db-prod-guard.test.js` protects production databases from unit-test
  writes after a prior test path could touch a live large registry.

### Risks

| Risk | Severity | Why It Matters |
| --- | --- | --- |
| Multiple canonical path names | High | Official Agent Nodes can split across DBs, making transcript/session/claim/receipt truth depend on which install or berth the operator used. |
| WAL sidecar drift | High | A copy, backup, migration, or consolidation that misses `*.db-wal` and `*.db-shm` can lose recent committed frames or leave a misleading snapshot. |
| Live-open migration | High | Moving a registry while a daemon still has it open can produce a clean-looking destination and a still-mutating source. |
| `synchronous = NORMAL` overclaim | Medium | WAL plus NORMAL is a reasonable performance setting, but the official contract should state the crash/power-loss durability boundary honestly. |
| Legacy profile and Homebrew DB residue | Medium | Doctor can warn about fragmentation, but official compliance should not depend on an operator inferring which warning matters. |

### Required Contract

Official compliance needs one named daemon registry path for stable runtime and a
separate, explicit profile path for opt-in dev berths.

Recommended naming:

```text
Stable canonical registry:
  ~/.port-daddy/port-registry.db

Stable sidecars:
  ~/.port-daddy/port-registry.db-wal
  ~/.port-daddy/port-registry.db-shm

Opt-in dev instance registry:
  ~/.port-daddy/instances/<label>/port-daddy.db
```

If the binder keeps `~/.port-daddy/daemon.db`, code and migration docs should move
there deliberately. Until then, use the path the consolidation and current stable
runtime already converge on: `~/.port-daddy/port-registry.db`.

Acceptance requirements:

- `pd status`, `/status`, `/health`, and `pd doctor --json` report the exact
  database path, WAL mode, busy timeout, and whether the path is stable or
  profile-scoped.
- Stable launchd starts without a dev `PORT_DADDY_PREFIX`; if `PORT_DADDY_DB` is
  set for stable, it must point at the canonical stable registry.
- `db-consolidate` and backups treat `.db`, `.db-wal`, and `.db-shm` as one DB
  family.
- Migration refuses apply mode while a source or destination DB family is live
  open by the daemon.
- Doctor marks DB fragmentation as a compliance blocker when any official Agent
  Node, transcript, receipt, cost, or claim row exists outside the canonical
  registry.
- Tests include a WAL-sidecar recovery fixture: write rows under WAL, leave
  frames in `-wal`, migrate the family, reopen, and prove the rows survive.

## Transcript Retention Default

### Current Evidence

Desired binder shape:

- Local transcripts are saved by default.
- Cloud upload/sync is opt-in.
- Ambient screen/audio capture is off by default.
- Disabling local transcript capture is a degraded privacy mode, not official
  operation.

Current code shape:

- `server.ts` wires `createTranscripts(db, { archiveSink })` and constructs the
  spawner with `enforceTranscriptPolicy: true`.
- `server.ts` enables `createJsonlTranscriptArchive()` by default and only disables
  it with `PD_TRANSCRIPT_ARCHIVE=off`.
- `lib/transcript-archive.ts` defaults to `~/.port-daddy/transcripts`, writes
  full finalized transcript JSONL records, and fsyncs by default.
- `lib/spawner.ts` refuses to run a backend when transcript start fails and flips
  a spawn to failed if append/finalize fails under enforcement.
- `lib/transcripts.ts` redacts common secret shapes and truncates oversized
  message/tool payloads with hashes.
- `fleet_transcripts.session_id` is nullable.
- `lib/spawner.ts` starts the transcript row before it calls `/sugar/begin`, and
  the `txStart` call does not pass a session id.
- `lib/transcript-store.ts` is a separate append-only event table with nullable
  `session_id`, no automatic redaction, no JSONL mirror, no retention policy id,
  no per-session sequence, and no hash chain.

### Risks

| Risk | Severity | Why It Matters |
| --- | --- | --- |
| `session_id: null` transcripts | Critical | The compliance plan explicitly treats a transcript without a joined session as non-official. It cannot support claims, control, receipts, or replay. |
| Two transcript stores with different guarantees | High | `fleet_transcripts` has redaction and JSONL archive; `transcript_events` has richer event intent but weaker retention and privacy guarantees. |
| Archive opt-out in official mode | High | `PD_TRANSCRIPT_ARCHIVE=off` is acceptable for test/eval/degraded privacy modes, but not for official coding agents. |
| No hash chain or retention policy in code schema | High | Work receipts cannot commit to a verifiable transcript head hash or demonstrate policy application. |
| Redaction asymmetry | High | `lib/transcripts.ts` redacts; `lib/transcript-store.ts` explicitly does not. Official Agent Events must not leak secrets through the weaker path. |

### Required Contract

Official agents need one transcript truth model with two durable projections:

- Hot query projection in SQLite.
- Append-only local archive under `~/.port-daddy/transcripts/`.

Acceptance requirements:

- An official spawn creates an Agent Node, session row, transcript id, and first
  user/system turn before any provider/backend/tool command can execute.
- Official `fleet_transcripts.session_id` and official `transcript_events.session_id`
  are never null. Historical imports may stay null only when classified
  `observed`.
- `transcript_events` grows required fields or an equivalent side table:
  `retention_policy_id`, `sequence`, `content_hash`, and `prev_hash`.
- Every official transcript finalization writes JSONL locally. Archive failure
  fails the official run or blocks admission before launch.
- `PD_TRANSCRIPT_ARCHIVE=off` downgrades all new bodies to `observed` or
  `privacy-degraded`; it must not admit official coding work.
- Redaction runs before persistence on every transcript path, not only
  `fleet_transcripts`.
- A compliance probe spawns a canary agent and proves:
  - non-null session id;
  - first prompt saved;
  - visible assistant/tool turn saved;
  - local JSONL archive record exists;
  - archive record hash matches SQLite projection;
  - stream route can replay the same run after daemon restart.

## Launchd Supervision Integrity

### Current Evidence

Desired runtime shape:

- The canonical Homebrew runtime owns the stable daemon.
- The stable daemon binds loopback TCP `9876`.
- The LaunchAgent label is `homebrew.mxcl.port-daddy`.
- The older `com.portdaddy.daemon` label is legacy and should not be required for
  new stable installs.
- `com.bosun.daemon` is a rival external supervisor and should not be touched as
  if it were Port Daddy.

Current code shape:

- `docs/operations/daemon-and-supervision.md` documents the Homebrew daemon,
  optional `com.portdaddy.bosun`, the rival `com.bosun.daemon`, the removed
  `com.portdaddy.daemon`, port-file discovery, and side-by-side dev berths.
- `cli/commands/diagnostics.ts` checks both `homebrew.mxcl.port-daddy` and
  `com.portdaddy.daemon` as possible Port Daddy supervisors.
- `assessSupervisionIntegrity()` is explicit about zero supervisors, duplicate
  supervisors, loaded-but-stopped supervisors, and non-Darwin skip behavior.
- Doctor checks binary drift, code hash, daemon liveness, LaunchAgent target,
  resource directory resolution, stale sockets, PID file staleness, DB integrity,
  DB fragmentation, agent MCP wiring, agent skill presence, and lifecycle hooks.
- `scripts/ci-doctor-gate.sh` boots the compiled daemon against a scratch
  prefix/DB and gates `pd doctor --json` plus `pd doctor --ci` on zero criticals.

### Risks

| Risk | Severity | Why It Matters |
| --- | --- | --- |
| Supervision warning instead of official gate | High | A reachable but unsupervised daemon can look healthy until it dies, leaving official agents orphaned. |
| Duplicate launchd jobs | High | Two KeepAlive jobs can race the canonical listener and confuse which binary/DB is authoritative. |
| Stale source-target plist | High | A launchd job targeting `tsx server.ts` can make a Homebrew upgrade look successful while running old code. |
| CLI-only hints | Medium | The operator surface should remediate through FleetBar/dashboard buttons, not terminal instructions. |
| Dev berth bleed into stable | Medium | `PORT_DADDY_PREFIX` and profile DBs are healthy for dev but must be obvious, gated, and non-canonical for official stable agents. |

### Required Contract

Official launch requires a supervisor verdict, not just daemon liveness.

Acceptance requirements:

- Stable official mode requires exactly one loaded and running Port Daddy
  supervisor. On macOS that should be `homebrew.mxcl.port-daddy` for the stable
  install.
- Duplicate `homebrew.mxcl.port-daddy` and `com.portdaddy.daemon` is a blocking
  compliance failure, not a warning.
- A reachable daemon with no running supervisor is blocking for official launch.
- The loaded plist must target the compiled daemon binary for the same install
  root as the operator's stable CLI.
- The stable daemon must report no binary drift, no route degradation, and the
  canonical DB path.
- Doctor JSON must expose a machine-readable `officialAgentReady` or equivalent
  section with supervisor label, pid, target binary, port, DB path, and failure
  remediation.
- FleetBar/dashboard must expose the restart/reinstall/remediation action. CLI
  hints are fine for agents, but the operator path must be a button or panel.

## Sandbox Containment Test Harness

### Current Evidence

Current code shape:

- `lib/coast-guard.ts` describes Coast Guard as confine, broker, and cap.
- It denies high-value secret paths and dotenv files through Seatbelt on macOS,
  Landlock/bwrap helpers on Linux when available, or reports `confined:false`.
- It scrubs managed secrets and dotenv-sourced keys from child environments.
- It wires HTTPS proxy variables to an egress meter with request/byte caps.
- It records receipts with `confined`, `mechanism`, `scrubbedSecrets`,
  `egressCap`, `egress`, `writePolicy`, and honest limitations.
- It explicitly states that current containment does not stop a malicious
  same-UID process, proxy bypass, or full write/critical/deploy/DB actions.
- `enforcedContainmentTier()` returns `read` at most and `null` when no OS
  sandbox is present or Coast Guard is disabled.
- Tests cover pure Seatbelt profile generation, secret env scrubbing, policy
  defaults, egress metering, spawner wiring, live macOS read denial, live
  read-only workdir write denial, SBPL injection failure, symlink append and
  traversal write-deny robustness.

### Risks

| Risk | Severity | Why It Matters |
| --- | --- | --- |
| Confined false still runs | High | For normal spawns this may be honest degraded behavior; official agents need admission to fail closed or downgrade. |
| Full-tier default outruns containment | High | Default spawned coding work can write freely while the sandbox only structurally contains read/exfil/spend. |
| Proxy bypass is known | High | SDKs that honor proxy env are bounded; raw sockets or proxy-ignorant clients escape until forced egress lands. |
| Destructive git and deploys are not structurally blocked | High | Bond pricing and receipts do not prevent force pushes, DB writes, or deploy actions. |
| Test coverage is strong but not packaged as one compliance harness | Medium | Official admission needs a single probe that exercises the same wrapper under launch conditions and returns a machine verdict. |

### Required Contract

Official Agent compliance must treat sandbox posture as a measured capability,
not an assumed property.

Acceptance requirements:

- Official coding agents require `coastGuard.enabled === true`,
  `confined === true`, and an OS mechanism appropriate to the platform. If no
  OS sandbox is available, admit only `observed` or `sandbox-degraded` bodies.
- For read-only or review agents, the containment harness must prove:
  - cannot read project `.env` and `.env.local`;
  - cannot read `~/.ssh` or other configured crown-jewel dirs;
  - cannot see managed provider secrets in the child environment;
  - cannot write inside the declared read-only worktree;
  - cannot evade write denial with append, symlink, or `..` traversal;
  - cannot bypass SBPL profile construction with unsafe path characters;
  - receives a receipt naming mechanism, policy, denied roots, scrubbed keys,
    and egress cap.
- For write agents, the UI must label containment honestly: current Coast Guard
  is not write/critical/full containment. The admission gate must require either
  a stronger mechanism or an explicit operator-approved higher-risk mode.
- Egress harness must prove over-cap requests receive `402 Spend Cap Exceeded`
  and that broker-injected secrets do not appear in child env or transcripts.
- Destructive git, DB write, deployment, and production-touch actions need a
  separate ToolGate/approval gate before the body can be considered official for
  those scopes.
- A single `pd agent compliance probe --provider <provider> --json` should return
  sandbox findings, not just general health findings.

## Secrets Custody

### Current Evidence

Desired binder shape:

- Secrets live in platform keyring/keychain by default.
- Remote grants are explicit and scoped.
- Secrets are redacted before persistence.
- No hidden upload of transcript or credential data.

Current code shape:

- `lib/secret-env.ts` snapshots sensitive environment variables at daemon startup,
  deletes them from `process.env`, and serves later reads from an in-module cache
  or OS keychain.
- `saveManagedSecret()` only accepts allow-listed provider keys and fails closed
  when the keychain is unavailable for console-entered values.
- `listManagedSecrets()` distinguishes `keychain`, `env`, and `unavailable`;
  env-backed values are marked unencrypted at rest.
- `routes/secrets.ts` exposes names/status without values, set/delete/reveal
  routes behind loopback guards, and never echoes secret values on set.
- `POST /secrets/:key/reveal` intentionally returns plaintext for operator copy
  workflows, but only through loopback and with allow-list validation.
- `lib/macaroon/store.ts` stores macaroon root and caveat keys in the OS keychain
  and keeps SQLite to non-secret metadata.
- Coast Guard scrubs managed keys plus dotenv-sourced keys before child spawn.
- `tests/unit/secrets-routes.test.js` covers status without values, no echo on
  set, unknown-key rejection, reveal, non-loopback reveal rejection, non-loopback
  write rejection, and non-loopback delete rejection.

### Risks

| Risk | Severity | Why It Matters |
| --- | --- | --- |
| Env cache is not encrypted at rest | High | A daemon launched with provider keys in env can be functional but not compliant with the managed secret custody target. |
| Reveal route is plaintext by design | High | Loopback is necessary but insufficient for remote-harbor or shared-machine official claims unless audit, TTL, and operator intent are explicit. |
| Transcript redaction is uneven | High | A weaker transcript path can persist a secret even if the Fleet transcript path redacts it. |
| Child env re-injection helpers exist | Medium | Some subprocesses need secrets, but official agents must prove raw keys are not inherited unless the body has an explicit scoped grant. |
| Portable fallback path exists | Medium | `~/.port-daddy-env` is useful for recovery, but should be a degraded state for official managed agents. |

### Required Contract

Official agents must receive capabilities, not ambient secrets.

Acceptance requirements:

- All managed provider secrets used by official agents are present in keychain or
  an equivalent encrypted platform store. Env-only storage is a compliance
  warning for operators and a blocker for remote/official launches.
- `/secrets` never returns values.
- `/secrets/:key/reveal` remains loopback-only and must produce an audit event
  with key name, requesting surface, operator/session identity when known, and no
  value.
- Every provider grant used by an agent is represented as a scoped capability
  row or macaroon metadata row with expiry, scope, and revocation state.
- Child process environments for official agents contain no raw provider keys
  unless the transcript records an explicit secret grant and the sandbox receipt
  marks the injection path.
- Transcript/event persistence redacts provider key shapes, bearer tokens,
  cloud tokens, database URLs, and dotenv-sourced values before writing SQLite or
  JSONL.
- A compliance canary plants a fake key in keychain and env, runs a spawned body,
  and proves the value does not appear in child env, stdout/stderr, transcript
  SQLite rows, JSONL archives, or receipt payloads.

## Doctor Remediation

### Current Evidence

Current code shape:

- `pd doctor --json` returns severity, summary, and check records.
- `pd doctor --ci` exits non-zero on critical health failures.
- Doctor can detect DB writability, SQLite integrity, DB fragmentation, daemon
  liveness, route degradation, binary drift, code hash mismatch, port conflicts,
  launchd supervision, Bosun presence, launch-agent target drift, resource
  directory confusion, agent MCP wiring, skill installation, and lifecycle hooks.
- Interactive fix handling exists for startup blockers.
- `pd setup`, `pd squid on`, and `pd guard install` cover parts of runtime
  wiring, but the compliance plan's `pd doctor --fix harness` lane is not yet the
  explicit official-agent remediation hub.

### Risks

| Risk | Severity | Why It Matters |
| --- | --- | --- |
| Generic doctor can be green while official-agent gates fail | High | A daemon can be healthy enough to run while missing non-null transcript joins, JSONL retention, sandbox admission, or secret custody. |
| CLI remediation leaks into operator UX | Medium | Agents can use CLI repair paths, but operators need FleetBar/dashboard controls. |
| Missing migration from unmanaged bodies | Medium | Existing Claude/Codex/local bodies need clear downgrade, migration, and proof states. |
| No single readiness verdict | Medium | Multiple green checks still require the operator or agent to infer whether launch is official. |

### Required Contract

Doctor needs an "Agent Harness" section with a blocking official readiness
verdict.

Required checks:

- canonical DB path and WAL sidecar family;
- DB fragmentation relative to official tables;
- transcript archive default on and writable;
- transcript/session join non-null for canary official spawns;
- transcript redaction probe;
- lifecycle hooks and MCP installed for each detected provider;
- pre-tool gate installed and able to deny destructive git;
- Coast Guard on, OS sandbox available, containment canary passed;
- keychain-backed provider secrets for any official body;
- launchd supervisor exactly one, running, and target binary current;
- FleetBar/dashboard remediation path registered for each operator-facing fix.

Required remediation actions:

- repair or reinstall provider hooks;
- repair MCP/skill wiring;
- rerun transcript backfill and classify unjoined history as `observed`;
- regenerate launchd plist through the operator surface;
- restart stable daemon through the operator surface;
- consolidate DB fragments with a DB-family backup;
- re-enable local transcript archive or downgrade bodies;
- re-run sandbox and secret canaries after repair.

## Acceptance Gates

These gates should be fail-closed for official Port Daddy Agents. A body may still
run in a degraded lane, but it must not receive the official label or official
controls until every required gate passes.

| Gate | Must Prove | Blocking Failure |
| --- | --- | --- |
| DB canonicality | One stable DB path, WAL on, `-wal` and `-shm` treated as DB family, no official rows outside canonical store | Any official row in a fragment, WAL not active, live-open migration source, or path ambiguity |
| Transcript retention | Local transcript capture on by default, JSONL archive writable, non-null session join, first prompt and tool turns persisted, hash chain/retention policy present | `session_id: null`, archive disabled, archive write failure, missing first prompt, missing hash/retention field |
| Supervisor integrity | Exactly one stable supervisor loaded and running, target binary current, no binary drift, canonical TCP/socket/DB reported | Zero supervisors, duplicate supervisors, loaded-but-stopped supervisor, stale source plist, drifted binary |
| Sandbox containment | Coast Guard on, OS sandbox active, canary cannot read secrets or write read-only workdir, egress cap blocks over-cap request | `confined:false`, Coast Guard disabled, secret read succeeds, write denial bypass succeeds, cap bypass unaccounted |
| Secrets custody | Provider secrets in keychain/equivalent store, scoped grants recorded, no raw key in child env/transcript/archive, reveal audited | Env-only custody for official body, unsupported plaintext fallback, leaked canary key, unaudited reveal |
| Doctor remediation | `pd doctor --json` exposes Agent Harness readiness, fix paths exist for every failing gate, FleetBar/dashboard action exists for operator fixes | Generic green doctor with official gate failure, CLI-only operator fix, no remediation for hook/transcript/sandbox/secret |
| Compliance probe | `pd agent compliance probe --provider <provider> --json` launches a canary through the real harness and returns a reproducible pass/fail packet | Probe absent, probe uses mocks only, canary not joined to session/transcript, no artifact path |

Minimum CI suite before official admission:

```text
npm test -- tests/unit/db-prod-guard.test.js
npm test -- tests/unit/transcript-archive.test.js
npm test -- tests/unit/spawner-transcripts.test.js
npm test -- tests/unit/transcript-store.test.js
npm test -- tests/unit/coast-guard.test.js
npm test -- tests/unit/coast-guard-egress-meter.test.js
npm test -- tests/unit/spawner-coast-guard.test.js
npm test -- tests/unit/secrets-routes.test.js
npm test -- tests/unit/diagnostics-doctor.test.js
scripts/ci-doctor-gate.sh
pd agent compliance probe --provider codex --json
pd agent compliance probe --provider claude-code --json
```

Platform live tests:

```text
npm test -- tests/unit/coast-guard-confinement-live.test.js
```

The live containment test can be platform-conditional, but official admission on a
machine cannot be conditional. If the current machine cannot prove an OS sandbox,
the launch lane is `sandbox-degraded`, not official.

## Recommended Work Order

1. Freeze the canonical DB path decision and make all stable runtime surfaces
   report the same path.
2. Promote DB-family migration/backups from maintenance tooling to an official
   admission check.
3. Fix spawner transcript/session join ordering or patch the transcript row after
   `/sugar/begin` so official runs cannot persist `session_id: null`.
4. Bring `transcript_events` up to official retention parity: redaction,
   retention policy id, sequence, hash chain, JSONL projection, and non-null
   official session join.
5. Add the Agent Harness section to doctor and make official readiness a single
   machine-readable verdict.
6. Package the existing Coast Guard tests into a provider-neutral containment
   probe that runs the actual wrapper under the current machine's launch posture.
7. Make env-only and fallback secret custody a visible degraded state.
8. Add FleetBar/dashboard remediation actions for restart, setup, hook repair,
   transcript archive repair, DB consolidation, and harness probes.
9. Only then allow the control panel to label a body an official Port Daddy Agent.

## Non-Goals

- This packet does not design the full Agent Node UI.
- This packet does not replace the transcript/receipt persistence contract work
  packet.
- This packet does not require cloud sync. Local durable state is the baseline;
  remote sync remains opt-in and encrypted.
- This packet does not claim current Coast Guard is a complete malicious-agent
  isolation boundary. It is cooperative-case defense plus honest downgrade until
  separate UID/VM and forced egress work lands.
