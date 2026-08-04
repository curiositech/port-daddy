# Squid 3.28.0 runtime and harness proof

Captured on 2026-08-04 from the clean linked worktree
`port-daddy-squid-harness-ship-20260804`. This is evidence, not a claim that the
old stable runtime repaired itself.

## Installed daemon diagnosis

- Homebrew resolves `pd` and `port-daddy` to the `3.27.0_3` keg and the CLI
  reports `3.27.0`.
- `homebrew.mxcl.port-daddy` kept PID 66889 alive while no process listened on
  `127.0.0.1:9876`; both `port-daddy status` and `/health` returned connection
  refused.
- The installed daemon is not the published 3.27.0 artifact. Its SHA-256 is
  `ca215884a387bcfc92c1751c9b2f5557221d90c19fecbe70a039d0d3502e959e`;
  the `port-daddy` file extracted from the official `v3.27.0`
  `pd-darwin-arm64.tar.gz` is
  `ee55f85692ec2bfad7ff33daf114009c4fd95acc1680c4d8abb339d43133d64b`.
  A feature binary had been copied over the keg without cutting a new version.
- The launchd log records a Bun segmentation fault followed by repeated
  `bosun_heartbeat_started` and `database_integrity_verified` cycles without a
  listener. The recovered source compiled `server.ts` directly; with ESM import
  order, its `__db_integrity_check` re-exec enters daemon boot again instead of
  acting as a leaf helper. That code path plus the repeated post-crash boot
  sequence explains the observed outage; the foreign keg hash prevents a
  stronger claim that the installed bytes are an official release build.

The code fix is deliberately small: the daemon build now enters through
`bin/port-daddy-daemon-bundle.ts`, which dispatches the authorized integrity
helper before importing `server.ts`; child re-entry fails closed. Canonical
port claims also reject an occupied OS listener and retry after releasing a
stale semantic assignment. The Homebrew runtime is not called repaired until
3.28.0 is published, installed, restarted by launchd, and answers on the
canonical lane.

## Named 3.28.0 feature daemon

`pd dev up --from "$PWD" --label squid-3-28-feature` built the first proof
berth on 3174. After accepting review fixes, the same command launched the final
candidate as `squid-3-28-final`; stable's repeated occupied renewal was escaped
through the selected loopback berth and the OS listener probe:

| Field | Observed value |
|---|---|
| URL | `http://127.0.0.1:3100` |
| health version | `3.28.0` |
| plane | `ephemeral:squid-3-28-final` |
| PID | `22926` |
| daemon SHA-256 | `e8707f4144803fcec992a2ae671fc67e5b89ad881aa1973fd8dd31938022004d` |
| runtime | `nominal`, no degraded reasons |
| process/listener count | one compiled daemon, one listener on 3100 |

The final compiled CLI used for artifact smoke has SHA-256
`593df7c204c42a1a65d7a04fcf48a98591970cde364c1037e71c2e155b4ea020`.
Its build receipt binds that binary and every staged Squid asset by SHA-256.
The daemon build receipt separately records a successful compiled
`port-daddy.db-integrity-proof.v1` helper smoke.

## Harness flow

Against the initial named feature daemon on 3174 (the same 3.28.0 daemon hash
recorded above):

1. `pd squid on` armed a fresh project and `pd squid status --json` reported
   `LIVE`, score 100, four detected/wired providers, `attentionInbox: true`,
   statusline identity, `/squid`, Pilot steering, and the managed attention
   SessionStart hook.
2. A synthetic agent received one direct message and one watched-channel
   message. `pd attention --peek` reported total 2, inbox 1, channel 1 without
   consuming them; the next `pd attention` consumed both and the following
   read reported zero unread.
3. The exact compiled SessionStart command consumed three queued inbox items.
   The Pilot hook returned structured `SessionStart` context in the same fresh
   project.
4. The release smoke began with a manual `pd attention --json` hook, proved the
   manual hook was preserved, and separately required the exact managed command
   `PD_SQUID_SESSIONSTART=1 "${PORT_DADDY_CLI:-pd}" attention --json 2>/dev/null || true`.
   The explicit feature CLI prevents login-shell initialization from silently
   selecting the installed Homebrew client. It then
   verified four-provider `READY` state and exact-root gating from outside the
   source tree.

Artifact result:

```text
SQUID RELEASE SMOKE PASS: 4 providers, state READY
```

## Literal proof media

The VHS tapes were regenerated through the compiled CLI while it targeted
`ephemeral:squid-3-28-feature`. Final frames were visually inspected: the
conformance recording shows `attention inbox ✓ SessionStart watch live` and
`INBOX ✓ direct attention at SessionStart`; the attention recording visibly
targets `http://127.0.0.1:3174` and reads back the subscriptions.

| Artifact | SHA-256 |
|---|---|
| `harness-conformance-live.gif` | `43ba7aee218c7b3965fcc60667ba70bb48ececff857a12ed0bd6aa8e64bdd96e` |
| `harness-conformance-live-dark.gif` | `2f0a7904820a70bf5d3d1f031f62beeec5fe00b1869cdf812e0cb601d124f52f` |
| `harness-attention-activation.gif` | `c7b642b709aa10dbd91c11069cff5a8636adae08c5465371033f751e67d64452` |
| `harness-attention-activation-dark.gif` | `cac1fd238ad8df410455e847e55459f51e5c027a9b77f35691bd8c2d218babb9` |

Three first-round documentation agents timed out and produced no output; they
are excluded from the release receipt. Only completed, transcript-backed
reviews count.
