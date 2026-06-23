# 0062. Auto-freshness self-heal — keep the live daemon + GUI current on a timer

## Status

Accepted

## Context

Port Daddy's live daemon is the **Homebrew build**, not the repo. Merging PRs
does not change what's running — the live daemon only advances when a release is
cut (`gh release create` → `release.yml` builds binaries + the FleetBar preview →
`update-homebrew` dispatches the tap formula bump) **and** the machine runs
`brew upgrade port-daddy`. That last step was manual, so the running daemon
routinely lagged the latest release by days. The daemon already *detects* this —
it emits a `binary_drift_detected` warning when its embedded version trails the
on-disk install (docs/operations/daemon-and-supervision.md, Consolidation TODO
#3) — but nothing ever *acted* on the warning. The FleetBar GUI drifted the same
way, and worse: it could be killed and simply stay dead.

The operator directive (2026-06-18): *"You should be auto-launching a new daemon
and GUI every timer too."* Chosen policy (operator, via AskUserQuestion):
**auto-upgrade + restart, hands-off; hourly cadence.** A freshly cut release
should land on the running machine without anyone typing `brew upgrade`.

## Decision

Add a **`pd self-update`** command and an **hourly LaunchAgent** that runs it.

### `pd self-update` (`cli/commands/self-update.ts`)

Each tick (macOS-only; a no-op elsewhere — it's launchd + Homebrew + a `.app`):

1. `brew update`, then `brew outdated port-daddy`.
2. If a newer release exists → `brew upgrade port-daddy` + `brew services
   restart port-daddy` (relaunch the daemon onto current code) + kill FleetBar so
   step 4 relaunches it onto the new version.
3. Ensure the daemon answers `/health`; if not, `brew services start port-daddy`
   (resurrect after the restart, or after a crash).
4. Ensure FleetBar is running; if not, `open -a` the app.

It is **fail-soft and loud**: every action is appended to
`~/.port-daddy/logs/freshness.log`, and a failed step never aborts the others —
a flaky `brew upgrade` must not leave the daemon down. The upgrade trigger is a
**pure function** `isUpgradeAvailable(brewOutdatedStdout)`, unit-tested without
shelling out (`brew outdated <formula>` prints the formula name when outdated and
nothing when current).

### The LaunchAgent (`install-daemon.ts`)

`installFreshnessMacOS()` writes `~/Library/LaunchAgents/com.portdaddy.freshness.plist`
running `pd self-update --tick` with `StartInterval=3600` + `RunAtLoad=true`. The
`--tick` flag suppresses human-facing console output (log-only). It is installed
alongside Bosun in **both** `installMacOS()` paths — the Homebrew-supervised
early-return and the self-supervised path — and torn down in `uninstallMacOS()`.
The `pd` launcher is resolved to an absolute path (`which pd`, falling back to the
Homebrew prefixes) because launchd jobs run with a minimal PATH; a missing
launcher (source checkout, pre-`brew install`) skips cleanly rather than failing
the install.

### Why a separate timer, not KeepAlive / not the daemon itself

- **Not KeepAlive.** `brew services` already KeepAlive-supervises the daemon
  *process*; freshness is a different axis (is the installed *version* current),
  needs a periodic poll, and must survive the daemon being down. A second
  KeepAlive job racing for `:9876` is the documented duplicate-supervisor failure
  this repo guards against.
- **Not inside the daemon.** A daemon cannot cleanly `brew upgrade` and restart
  *itself* (it would tear down the process running the upgrade). An external
  LaunchAgent is the correct actor to replace the daemon under it.
- **Hourly, not on-every-CLI-invocation.** The existing `cli/utils/freshness.ts`
  already nudges on interactive CLI use; this covers the **idle machine** that may
  not run a `pd` command for hours but should still pick up a release.

## Consequences

- **Positive.** A cut release reaches every running machine within the hour,
  hands-off — daemon and GUI both. The long-detected-but-unacted
  `binary_drift_detected` warning finally has a consumer. Greppable freshness log
  for "did it upgrade, when, why."
- **Cost.** One `brew update` per hour (network + a few seconds). A bad release
  auto-propagates within the hour — mitigated by the release gate (CI green +
  FleetBar-essential, ADR via `release.yml`) being the place correctness is
  enforced; rollback is a follow-up `brew pin` / formula revert.
- **Reversible.** `launchctl unload ~/Library/LaunchAgents/com.portdaddy.freshness.plist`
  (or `pd uninstall`) removes it; `pd self-update` remains runnable by hand.
- **macOS-only for now.** Linux/systemd freshness (a `.timer` unit) is a tracked
  follow-up; `self-update` already no-ops off macOS so the command is safe everywhere.

## Related

- docs/operations/daemon-and-supervision.md — the daemon topology + the
  `binary_drift_detected` warning this consumes (Consolidation TODO #3).
- `cli/utils/freshness.ts` — the complementary on-CLI-invocation freshness nudge.
- ADR-0084 — daemon berths (the isolated-port daemon used to validate spawn paths).
- Operator directive 2026-06-18 ("auto-launching a new daemon and GUI every timer").
