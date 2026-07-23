# 02 Runtime Authority And Deployment

## Authority rule

The local Port Daddy daemon is authoritative for a local harbor.

The native app, CLI, FleetBar, editor plugins, mobile app, MCP tools, and web UI
are clients. They may cache, display, and request actions, but the daemon owns:

- Agent Node registration;
- transcript ingestion and append-only event order;
- claims, locks, parleys, and conflict predictions;
- worktree registry and sandbox policy;
- budgets, approvals, kill switch, and guard decisions;
- local memory and skill indexes;
- relay membership and cloud sync state;
- compliance probes and remediation state.

Remote or hosted harbors can be authoritative for their own domains, but the UI
must say which harbor owns which agent. "Cloud agent" cannot mean "mysterious
thing somewhere." It must show authority, data path, billing path, and controls.

## Harbor authority protocol

Shared, remote, and public harbors need a single-writer story, not just signed
events.

Every harbor should have:

- `harbor_id`;
- authority epoch;
- current writer lease holder;
- event sequence;
- causal parent ids;
- revocation list;
- per-artifact ACLs;
- retention policy;
- control command ack/failure records.

Rules:

- one authority writes the canonical sequence for a harbor epoch;
- remote bodies can propose or stream events, but the authority orders them;
- mobile commands are queued with expiry and must receive ack/failure;
- revoked guests cannot read new transcripts or issue new control commands;
- offline commands that arrive after revocation fail visibly;
- retention conflicts resolve by the stricter policy for shared artifacts unless
  the artifact owner explicitly exports or transfers ownership.

This deserves a dedicated Harbor Authority ADR before team/public harbors ship.

## Deployment modes

Local-only:
  Everything runs on the user's machine. Secrets stay in Keychain or local
  encrypted storage. Transcripts stay local unless the user exports them.
  Local agents can still call provider APIs with user keys.

Hybrid relay:
  The local daemon remains authoritative. `portdaddy.dev` provides identity,
  device pairing, push notifications, and relay messages. Transcript sync and
  mobile transcript viewing are opt-in.

Hosted remote session:
  A remote Port Daddy daemon or worker runs an Agent Node in a cloud sandbox.
  The remote harbor is authoritative for that node while it runs. It streams
  events back to the user's local or account harbor. Costs and retention must be
  visible before launch.

Team harbor:
  Multiple users and devices share a harbor with explicit capabilities. The host
  may be a local daemon, a self-hosted daemon, or a Port Daddy hosted harbor.
  Claims, transcripts, and memory are scoped by project, role, and consent.

Public harbor:
  A discoverable or marketplace-like harbor for public agents, skills, or
  simulations. Public harbors need stronger governance: signed cards, moderation,
  revocation, rate limits, abuse handling, and clear data boundaries.

## Agent deployment lanes

Every Agent Node launch should declare both where it will run and whether it is
being tested or admitted to the production harbor.

Local development lane:
  `pd spawn --dry-run --backend <backend> --budget <usd> --identity
  <project:stack:context> -- "<task>"` runs the same launch validation, budget
  check, model-tier resolution, worktree check, and squid-hook plan without
  materializing a process. This is the Agent Lab path: authors can test a new
  agent card, backend, prompt, tool list, worktree binding, and compliance probe
  before the registry treats it as live.

Local production lane:
  `pd spawn ...` creates the Agent Node under the local daemon. The daemon is the
  authority, the registry row carries repo/worktree scope, transcripts and tool
  gates stream locally, and the operator can interrupt or retire the node from
  pd-console/FleetBar.

Cloudflare development lane:
  Run the relevant Worker with Wrangler local/miniflare and register projected
  telemetry as observed remote agents. This lane is for testing prompts,
  payloads, secret bindings, queue delivery, GitHub App events, and transcript
  ingestion without granting production harbor authority.

Cloudflare production lane:
  Deploy the Worker fleet (`apps/relay`, `apps/fleet-executor`, GitHub App fleet
  receivers) with explicit Cloudflare bindings and secrets. The Worker becomes a
  remote body whose events stream back to the user's local or account harbor.
  The card must show remote authority, Cloudflare lane, budget owner, retention,
  and revocation controls before launch.

Custom agent lane:
  A custom runtime targets the same Agent Node API: register, heartbeat, stream
  transcript events, submit tool intents, accept control commands, and emit a
  Work Receipt. Until it satisfies the compliance probe it is `observed` or
  `dev`, not production compliant.

## What users should see

Every Agent Node card should display:

- authority: local daemon, team host, hosted Port Daddy, Cloudflare Worker, or
  custom remote;
- body: Claude Code, Codex CLI, Cloudflare AI, Ollama, LM Studio, custom, human;
- compliance level;
- model tier and provider, using tier names such as fast, mid, strong, or
  local rather than hard-coded model marketing names in general UI;
- whether transcripts are local only, synced encrypted, or capture-disabled in
  degraded privacy mode;
- budget, spend so far, and who pays;
- sandbox level and worktree path;
- current permissions and pending approvals;
- last heartbeat and last transcript event.

Anything less invites the operator to infer trust from vibes.

## Files, folders, and workspaces

Port Daddy needs a predictable storage layout:

```text
~/.port-daddy/
  daemon.db
  daemon.port
  harbors/
    <harbor-id>/
      ledger.sqlite
      transcripts/
      blobs/
      memory/
      skills/
      worktrees/
      artifacts/
      exports/
  profiles/
  logs/
  caches/
```

Repository-local state should stay minimal and explicit:

```text
<repo>/
  .port-daddy/
    harbor-card.json
    project-policy.json
    agent-hints/
```

Worktrees should default under a Port Daddy controlled root, not random temp
folders:

```text
~/coding/.pd/worktrees/<repo-slug>/<agent-node-id>/
```

Each worktree record must include:

- global path;
- base repo and remote;
- base commit;
- branch;
- owning Agent Node;
- sandbox policy;
- file and symbol claims;
- created files;
- modified files;
- PR links;
- cleanup eligibility.

## Sandbox ladder

Port Daddy should make sandbox strength visible and composable:

Level 0 - observed only:
  The daemon records transcript and heartbeats but cannot enforce tools. This is
  useful for attached legacy agents but should show as non-compliant or weakly
  compliant.

Level 1 - linked worktree:
  The agent works outside the main checkout. Port Daddy can inspect diffs,
  claims, commits, and PRs. This is the minimum for official task agents.

Level 2 - Coast Guard subprocess guard:
  The daemon scrubs environment variables, caps egress and cost, blocks unsafe
  commands, and wraps subprocess execution.

Level 3 - OS sandbox:
  macOS Seatbelt, Linux bubblewrap or Landlock, and explicit path/network
  grants. The agent cannot casually wander outside its capability envelope.

Level 4 - Apple container or equivalent:
  Stronger isolation for local agents once Apple's container stack or equivalent
  is mature enough for developer workflows.

Level 5 - remote sandbox:
  Cloudflare Worker, VM, container, or hosted runner with signed capability
  cards, secrets injection, transcript streaming, and cost metering.

The UI should not bury this. If a Voyager is editing local files at Level 1 while
another is running in a remote Level 5 sandbox, the operator should see that.

## Remote sessions

A remote session is not just a background job. It is an Agent Node whose body
happens to be remote.

Remote launch must create:

- Agent Node soul in the user's harbor;
- remote body identity and heartbeat;
- worktree or remote filesystem binding;
- transcript stream;
- budget and timeout;
- sandbox policy;
- secret grants;
- capability card;
- final artifact path and cleanup policy.

Remote sessions should support:

- stream events over SSE/WebSocket;
- checkpoint export;
- pause and interrupt;
- successor/takeover without deleting old transcripts;
- explicit teardown;
- artifact retrieval;
- cost reconciliation.

Wake sources:
  A remote or local Agent Node is woken by a bounded, enumerated set of
  sources, not an open-ended callback surface. Cloudflare's actor model exposes
  six — HTTP request, WebSocket connect, RPC or sub-agent return, scheduled
  alarm, email, and external event — where the agent's name is the routing key.
  Port Daddy's trigger registry (`lib/fleet/triggers/`) is the same shape with a
  coordination-native twist. The wake sources live today are:

  - file: a watched path changes;
  - webhook: an HMAC-verified inbound HTTP delivery;
  - cron/schedule: a time expression fires;
  - tuple-mailbox match: a coordination tuple the agent is waiting on is
    posted, which Cloudflare has no equivalent of;
  - inbox message: a note, claim, or session event on a `pd:*` channel.

  Email, SMS, and calendar sources are registered but stubbed — their
  `available()` reports not-ready until they are wired. Every wake source is
  provenance-classified and passed through the fail-closed trust gate before it
  may spawn or wake an Agent Node: the content author is authenticated, never
  the transport (ADR-0093). A wake source is an authorization question, not just
  a delivery mechanism, and each new one widens the injection surface the gate
  must cover.

Hibernate versus resume:
  Cloudflare hibernates a Durable Object to zero cost after roughly 70-140s of
  idle and wakes it in place with its co-located SQLite state intact — the same
  actor, the same memory, resumed. Port Daddy's daemon is a single always-on
  process, so every wake through the fleet spawn path is a fresh OS-process
  spawn plus context injection (handoff capsule and inbox), not an in-place
  resume of a suspended actor. This is a deliberate difference, not a missing
  feature: one always-on daemon on one operator's machine has no idle-cost
  problem to solve, so there is nothing to hibernate to zero and nothing to
  revive in place. The durability lives in the shared ledger and the injected
  capsule, not in a frozen process image. Harness-native session resume
  (`claude --resume`, `codex exec resume`) is a separate, adapter-owned
  continuation path and does not change this daemon-level model — see ADR-0118.

Remote interrupt race test:
  Start a remote Agent Node, issue a mobile interrupt, revoke the device before
  ack, and verify the command either fails with a recorded reason or is
  acknowledged before revocation. No silent half-control state.

## Account and website responsibilities

`portdaddy.dev` must eventually be more than docs:

- create account and sign in;
- download signed apps and CLI;
- pair devices;
- manage subscription;
- create or join team harbors;
- choose cloud sync and retention settings;
- register provider keys if the user chooses cloud vault mode;
- view usage and server-time costs;
- export and delete data;
- configure hosted remote agents;
- show relay health and paired devices;
- manage public or shared skills.

Local-only mode should not require an account. Hybrid and hosted modes do.

## Daemon state-plane identity

Status: shipped behind PR #1724, pending merge.

Local daemons do not all carry the same authority. The machine runs three lanes:

Stable plane (`prod`):
  The canonical daemon on :9876 with the `~/.port-daddy` prefix. Its state is
  the durable truth for the local harbor.

Dev-latest plane (`dev-latest`):
  The supervised development daemon on :9886 with its own prefix. Long-lived,
  but its writes are not prod truth.

Ephemeral plane (`ephemeral:<label>`):
  Feature and test daemons on ports >= 9900, each with an isolated prefix.
  Disposable by construction.

Every daemon self-classifies its plane at boot (`lib/state-plane.ts`, will land
with PR #1724): an explicit `PORT_DADDY_PLANE` override wins (unrecognized
values are namespaced into `ephemeral:` so a typo can never masquerade as
prod), then the canonical `~/.port-daddy` prefix resolves to `prod`, then the
:9886/dev-latest lane, else `ephemeral:<label>`. The plane travels with the
daemon's identity everywhere a client could be confused:

- `GET /version` and `GET /health` carry a `plane` field (absent on legacy
  daemons, so clients must treat missing as unknown, not prod);
- the berth registry record and the Bosun heartbeat payload carry the plane;
- the CLI prints a one-line stderr banner before the first mutating command in
  a process when the target daemon is not on the prod plane. Read-only
  commands never probe; failures stay silent; identity only, no write policy.

Write policies, provenance envelopes, and quarantine are later slices. S1 is
strictly "know which plane you are talking to."

Known hazard — roadmap snapshot divergence:
  The committed roadmap snapshot carries 151 items while the :9876 daemon's
  roadmap export shows roughly 127-128 (the DB fragmentation/continuity bug).
  A full snapshot export from the smaller side silently deletes live items.
  Current mitigation is a surgical union: add new items, bump count and
  timestamp, remove nothing. The planned fix is a single-authority export
  whose output is stamped with the source daemon's plane header, so a
  non-prod export can never overwrite the committed snapshot unnoticed.

## Daemon freshness and versioning

Every client should show:

- daemon version;
- app version;
- CLI version;
- schema version;
- whether this client is talking to the expected daemon;
- whether the daemon is stale compared with the installed app;
- whether a migration or restart is needed.

`pd doctor` should be the remediation hub. It should check hooks, MCP config,
daemon health, app signature, transcript path, account pairing, provider keys,
worktree root, sandbox support, and stale versions. It should offer fixes with
plain explanations.

## Migration from existing launch paths

The old launch vocabulary should dissolve. `dispatch`, `sortie`, and `spawn`
describe implementation history, not a mental model the operator should learn
and not separate internal abstractions the daemon should preserve.

There should be one creation path:

1. Capture a Work Intent.
2. Run the Work Planner.
3. Create a Work Plan.
4. Materialize zero or more Agent Nodes only when the plan has enough evidence,
   authority, transcript routing, workspace, budget, and control policy.
5. Attach a body through an anode adapter when execution actually begins.

Existing commands may remain as compatibility shims during migration, but they
should call the same Work Intent service:

- queued/background request: Work Intent with `start_policy: background`;
- interactive request: Work Intent with `start_policy: operator_present`;
- compatibility bridge request: Work Intent with an adapter preference;
- cloud request: Work Intent with a remote placement preference;
- imported or already-running body: Work Intent with `attach_existing: true`.

Those are fields, not verbs. They should not create distinct transcript stores,
authority paths, workgroup concepts, or control panels. The daemon should be
able to answer every launch-path question with one record: which Work Intent
created which Work Plan, which Agent Nodes were materialized, which bodies were
attached, and what the Articles of Agreement allowed.
