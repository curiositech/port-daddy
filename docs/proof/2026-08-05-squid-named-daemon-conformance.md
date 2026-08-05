# Squid named-daemon conformance proof

- Date: 2026-08-05
- Candidate: Port Daddy 3.28.0 at `24fb87393`
- Runtime: named development daemon `squid-3-28-e2e`

This proof deliberately omits the daemon's TCP port. Every command selected the
named profile, read its published endpoint at runtime, and exported that endpoint
to the child. The preferred seed is only a starting point. The exact candidate's
`dynamic-tcp-listener` regression occupied its chosen preferred port and proved
that the listener published a different healthy endpoint; the complete suite also
passed the repository-wide hard-coded daemon URL ban.

## Primary Squid and attention flow

| Evidence | Durable identifier |
| --- | --- |
| Receipt | `run-abf03776b304bc4a` |
| Session | `session-final-named-daemon-squid-attention-and-durable-r-04645bfa1346` |
| Agent | `spawned-970bcc1f0b93` |
| Transcript | `tx_msg36m3c_utoz6jh7` |
| Terminal marker | `SQUID_328_FINAL_ATTENTION_OK` |

The harnessed Codex agent ran `pd attention`, `pd sitrep`, `command -v pd`,
`pd version`, `pd status --json`, and `pd squid status --json` against the
selected named daemon. It observed the profile-local source CLI, version 3.28.0,
revision `24fb87393`, no binary drift, and Squid LIVE with a score of 100 and all
tentacles wired.

The completed receipt records:

- no execution deadline;
- a $0.20 budget and $0.072652 exact cost;
- 254,334 input tokens, 213,120 cached tokens, and 5,724 output tokens; and
- a non-null Coast Guard result: confined by macOS Seatbelt, egress recorded,
  and zero blocked requests.

## Linked continuation and idempotent admission

The green session above was continued twice with the same intent and idempotency
key. The first admission reported `replayed: false`; the second reported
`replayed: true`. Both returned the same durable identities:

| Evidence | Durable identifier |
| --- | --- |
| Receipt | `run-1f0083097c8f4d3b` |
| Successor session | `session-idempotent-linked-continuation-conformance-for-f-0a49ffda6035` |
| Agent | `spawned-9e368c498bb2` |
| Transcript | `tx_msg3as97_q3ts3kb9` |
| Predecessor | `session-final-named-daemon-squid-attention-and-durable-r-04645bfa1346` |
| Terminal marker | `SQUID_328_FINAL_CONTINUATION_OK` |

While the continuation was running, collection showed a positive child PID and
fresh heartbeat. After completion it showed `live: false`, preserving the
terminal receipt rather than confusing process death with lost work. The receipt
records a $0.15 budget, $0.095969 exact cost, 163,189 input tokens, 82,432 cached
tokens, 6,493 output tokens, and non-null Seatbelt confinement with recorded
egress. No generic wall-clock deadline was installed.

## Candidate validation

The final source candidate passed 533 Jest suites with 11,399 tests green and 10
intentional skips. TypeScript typechecking passed. All 13 version authorities
reported 3.28.0; all 13 skill mirrors agreed; the public boundary passed; and 244
changed documentation files were citation-clean. The named daemon was then rebuilt
from `24fb87393`; its health and status projections agreed on the source worktree,
revision, version, selected profile, and zero binary drift before Squid was armed.

## Diagnostic progression

The failed receipts are retained because they distinguish liveness, reachability,
and sandbox authority instead of hiding the recovery path.

| Receipt | What it proved |
| --- | --- |
| `run-3c636c35665d7675` | Codex's inner workspace sandbox blocked loopback; Coast Guard had not wrapped the child. |
| `run-28a798a6a12cb0ce` | Adding Coast Guard exposed invalid nested macOS Seatbelt confinement. |
| `run-70b76791c50108f0` | One sandbox authority restored coordination, but the installed CLI compared the named daemon with the canonical runtime. |
| `run-676c0ace8547dac4` | A profile-local source CLI existed, but the model shell filtered its environment. |
| `run-5d7f7ee242770a23` | An oversized PATH override failed closed before launch. |
| `run-d8b784a201e6e4a6` | A login shell reset the bounded PATH to the installed CLI. |

The final runtime fixes therefore have narrow jobs: one sandbox authority,
strict propagation of the selected non-secret daemon context, a bounded PATH,
and profile-local shell initialization that keeps named development daemons
paired with the source CLI that launched them.
