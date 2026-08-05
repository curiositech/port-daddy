# Squid named-daemon conformance proof

- Date: 2026-08-05
- Candidate: Port Daddy 3.28.0 at `6beb09700`
- Runtime: named development daemon `squid-3-28-e2e`

This proof deliberately omits the daemon's TCP port. Every command selected the
named profile, read its published endpoint at runtime, and exported that endpoint
to the child. The preferred seed is only a starting point: a separate collision
probe occupied the source-defined default, started an isolated 3.28 daemon, and
verified that the daemon published a different healthy endpoint.

## Primary Squid and attention flow

| Evidence | Durable identifier |
| --- | --- |
| Receipt | `run-f0322ea20bf876ff` |
| Session | `session-proven-named-daemon-attention-and-receipt-confor-33277d052198` |
| Agent | `spawned-2bf991374106` |
| Transcript | `tx_msg067de_lzpcb2z5` |
| Terminal marker | `SQUID_NAMED_DAEMON_CONFORMANCE_OK` |

The harnessed Codex agent ran `pd attention`, `pd sitrep`, `command -v pd`,
`pd version`, `pd status --json`, and `pd squid status --json` against the
selected named daemon. It observed the profile-local source CLI, version 3.28.0,
revision `6beb09700`, no binary drift, and Squid LIVE with a score of 100 and all
tentacles wired.

The completed receipt records:

- no execution deadline;
- a $0.15 budget and $0.05316 exact cost;
- 212,205 input tokens, 169,088 cached tokens, and 1,809 output tokens; and
- a non-null Coast Guard result: confined by macOS Seatbelt, egress recorded,
  and zero blocked requests.

## Linked continuation and idempotent admission

The green session above was continued twice with the same intent and idempotency
key. The first admission reported `replayed: false`; the second reported
`replayed: true`. Both returned the same durable identities:

| Evidence | Durable identifier |
| --- | --- |
| Receipt | `run-525ab55201c659a8` |
| Successor session | `session-idempotent-linked-continuation-conformance-855cad0ce930` |
| Agent | `spawned-333404feb66f` |
| Transcript | `tx_msg07z6w_g35ptthi` |
| Predecessor | `session-proven-named-daemon-attention-and-receipt-confor-33277d052198` |
| Terminal marker | `CONTINUATION_CONFORMANCE_OK` |

While the continuation was running, collection showed a positive child PID and
fresh heartbeat. After completion it showed `live: false`, preserving the
terminal receipt rather than confusing process death with lost work. The receipt
records a $0.12 budget, $0.037509 exact cost, 119,439 input tokens, 91,648 cached
tokens, 2,176 output tokens, and non-null Seatbelt confinement with recorded
egress. No generic wall-clock deadline was installed.

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
