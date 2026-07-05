# 06 Security Privacy Billing And Accounts

## Privacy stance

Port Daddy should be local-first by default.

Default:

- all agent transcripts stored locally by default;
- secrets stored in macOS Keychain or platform equivalent;
- daemon bound to localhost;
- no transcript upload without explicit opt-in;
- no ambient screen/audio capture by default;
- export and delete available;
- kill switch outside the agent runtime.

Cloud features must be explicit product choices, not accidental side effects.

## Account model

Local-only users should be able to use Port Daddy without an account.

An account becomes useful for:

- signed downloads and update channel;
- subscription and billing;
- relay and mobile pairing;
- push notifications;
- team harbors;
- hosted remote agents;
- optional encrypted transcript sync;
- optional encrypted secrets vault;
- public skill sharing;
- usage history across devices.

Account foundation should appear during onboarding, not only in a late cloud
phase. Milestone 3 should support local-only no-account setup plus optional
passkey sign-in, signed download/update identity, and device pairing. Hosted
agents, cloud vault, teams, and public harbors remain later gated features.

The website must therefore include:

- sign up and sign in;
- device pairing;
- downloads;
- billing plan;
- cloud sync settings;
- team and harbor management;
- provider key settings if cloud vault is enabled;
- data export and deletion;
- privacy policy and retention controls.

## Secrets

Default secret storage:

- local Keychain on macOS;
- platform keyring on Linux/Windows;
- per-provider and per-harbor scopes;
- never print secrets in transcript;
- redaction before persistence;
- explicit grant to remote sessions.

Optional cloud vault:

- opt-in only;
- encrypted at rest;
- envelope keys or user-held keys where practical;
- per-harbor grants;
- audit log for access;
- easy revoke;
- no silent migration from local to cloud.

If a user brings their own provider keys, the UI must show:

- where the key is stored;
- which agents can use it;
- whether it can leave the machine;
- expected billing path;
- last used time;
- revoke button.

## Billing and server time

Billing modes:

Local-only:
  No Port Daddy server-time charge. The user may still pay providers directly
  through BYOK.

Hybrid relay:
  Subscription covers relay, pairing, notifications, and lightweight metadata
  sync. Transcript sync may be tiered by storage.

Hosted agents:
  Port Daddy charges for compute, orchestration, storage, and possibly provider
  pass-through unless the user brings keys. The launch flow must show budget and
  max cost before running.

Team harbor:
  Per-seat plus usage, or harbor-level subscription. Team admins manage cloud
  storage, keys, and retention.

Public harbor:
  Marketplace or hosted plans need abuse controls, rate limits, and clear
  responsibility for model/API costs.

Cost controls:

- daily, hourly, monthly, per-agent, and per-run caps;
- model tier defaults;
- local/cheap triage before expensive calls;
- approvals for cost spikes;
- visible spend on Agent Node card;
- budget event transcript entries.

## Retention and deletion

Retention should be per harbor:

- default: record all agent transcripts locally until retention policy removes
  or distills them;
- optional privacy mode: do not record transcripts, clearly marked as degraded
  because search, resume, receipts, memory, and learning are weakened;
- record locally for N days;
- record locally until manual delete;
- encrypted sync for N days;
- keep permanent project memory but delete raw transcripts after distillation;
- export before delete.

Users need:

- view stored data;
- export transcript and memory;
- delete one session;
- delete one project;
- wipe cloud copy;
- pause local transcript capture only as an explicit degraded privacy mode;
- pause ambient screen/audio capture independently;
- pause one agent;
- redact a secret leak retroactively while preserving an audit marker.

Deletion should not silently rewrite shared history. Use tombstones and redact
payloads while preserving event hashes where necessary.

Derived memories that depended on deleted payloads must be marked degraded,
invalidated, or backed by an approved digest. This preserves privacy without
letting stale memories masquerade as fully sourced facts.

## Security boundaries

Critical boundaries:

- agent body versus daemon;
- daemon versus local filesystem;
- local harbor versus remote relay;
- provider API versus Port Daddy account;
- MCP/tool server versus agent;
- user secrets versus team secrets;
- transcript payload versus derived memory;
- public skill versus private skill.

Every tool and endpoint should know which side of a boundary it is on.

## MCP and script risk

MCP servers and scripts can act like arbitrary code. Port Daddy should:

- require manifests;
- display requested permissions;
- sandbox where possible;
- log tool calls;
- redact secrets;
- scope filesystem access;
- require approval for broad or destructive actions;
- support deny lists;
- include `pd doctor` checks for missing or modified MCP config;
- show when hooks or MCP tools have been disabled.

The operator should not discover a missing hook only after an agent acts
unguarded. Runtime checks should report misconfiguration in the app.

## Destructive action policy

Block or require approval for:

- `git reset --hard`;
- `git clean -fd`;
- deleting worktrees;
- force pushes;
- broad `rm -rf`;
- secret writes;
- deploys;
- billing changes;
- publishing public skills;
- posting external comments when policy says draft first;
- large network exfiltration;
- editing outside granted paths.

Offer safe alternatives:

- stash instead of reset;
- new worktree instead of overwriting;
- draft PR instead of direct push;
- shadow patch instead of direct file edit;
- operator approval instead of silent action.

## Data revealed to user

The user should see enough to make informed decisions:

- whether an agent is local or remote;
- whether transcript capture is active;
- where transcripts are stored;
- whether secrets can leave the machine;
- current provider/model tier;
- budget and spend;
- sandbox level;
- permissions granted;
- recent tool calls;
- pending risky action;
- compliance failures.

Avoid scary low-level walls of text in routine flows. Use plain summaries with
drill-down.

## Threats to design against

- agent fabricates compliance;
- custom tool bypasses guard;
- hook silently removed;
- cloud relay sees plaintext when user expected local-only;
- team member sees private transcript;
- prompt injection through MCP or webpage;
- stale memory causes bad action;
- public skill contains malicious instructions;
- provider key leaks into transcript;
- runaway background agent burns budget;
- remote worker continues after user thinks it stopped.

Each threat needs a probe, UI state, and remediation path.

Compliance fabrication controls:

- daemon-issued Agent Node ids;
- signed Articles;
- adapter nonce challenge;
- expiring capability leases;
- daemon-witnessed tool decisions;
- negative probes that check side effects outside the adapter's own claims;
- downgrade to unmanaged when hooks, MCP gateway, or config hashes drift.

## Safety defaults

Default policy:

- local-first;
- least privilege;
- no consequential autonomous action without policy;
- visible transcript capture state;
- local transcript capture on by default;
- visible cloud state;
- cost caps on;
- destructive git blocked;
- hooks named honestly;
- `pd doctor` remediation available;
- export/delete available;
- stale agents marked stale.

Trust is built by showing the machinery, not by promising it is fine.
