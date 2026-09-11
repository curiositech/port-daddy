# Local Off: implementation and evidence

Status: hook admission published in #10137; native controls and runtime enforcement
are source-built and under review in regular PR #10138. Complete application/runtime
Off proof is unfinished. Both PRs are published through the configured GitHub App;
exact-head LFS uploads succeeded before their Git pushes.
The September operator halt remains in effect. This document does not authorize
starting a daemon, app, service, backend or paid run.

## Meaning and boundary

Automatic Git hooks must not invoke `pd`, publish events or start background
helpers while the operator has disabled hooks or halted the runtime. The
machine-wide `~/.port-daddy/hooks.disabled` and `HALT` markers take precedence over
a selected `PD_HOME` and explicit readiness/halt paths. Missing or invalid local
readiness denies automatic admission. Hooks never create readiness or remove a
stop marker; a healthy heartbeat is not permission to lift an existing stop.

`lib/hook-runtime-gate.ts` emits one embedded shell gate for managed Git guards,
the Git shim, post-commit templates, the Pilot installer and the console's
automatic post-merge rebuild. The standalone Pilot rechecks the same policy in
JavaScript before stdin, its optional salvage request and output. Shared fixtures
compare the shell and standalone predicates, including malformed witnesses.
The repository SessionStart attention and UserPromptSubmit skill-sync hooks stay
registered through `hooks/repo-lifecycle`, which embeds the same gate before
invoking either helper. On/Off transitions never require removing or reinstalling
the hooks.

Off skips the Port Daddy block in a merged hook, not unrelated user commands.
The checked-in pre-commit keeps ordinary staged-file validation independent of
Port Daddy; only its PD secret scanner is gated. Off skips that scanner and is
not a passing secret-scan result. Neither those checks nor the independent secret
scanner requires a Coordination Guard installation.
The checked-in publisher preserves Git LFS. A disabled Git shim delegates to real
Git without calling the CLI or writing Port Daddy audit records. Turning off
coordination is not permission to bypass GitHub branch protection or other tools.

An installed scoped publisher is not necessarily current. Old custom publishers
without the exact gate are reported as needing review, not silently overwritten
or falsely reported upgraded. Installing source is separate from repairing copies
already staged on a machine. No installer in this slice clears the stop marker.

These hook gates are cooperative product gates, not hostile-code containment. They do not
revoke already-running processes, atomically mediate effects after admission, or
prove that an arbitrary same-user process cannot read credentials. Drydock's
external execution boundary is still proposed; no whole-app zero-spend claim is
made here.

## Off-control task list

- [x] Inventory source and installed Git/harness entry points without running them.
- [x] Gate managed Git guards, shim and publishing templates before invocation.
- [x] Gate Pilot steering/networking and retain attention behind a pre-invocation
  gate. Keep skill sync registered and gated too.
- [x] Preserve ordinary pre-commit checks, Git LFS and foreign hook bodies across
  On → Off → On without reinstalling hooks; exercise transitions with stand-ins.
- [x] Gate automatic post-merge console rebuilding.
- [x] Repair this operator's identified installed Git hooks, Git shim, stale
  pre-compaction pair and Pilot script; preserve unrelated hook bodies.
- [x] Complete adversarial regression validation and publish hook PR #10137:
  155 current selected tests pass for the hook-preservation correction. The
  earlier 12 intercepted Pilot cases remain prior evidence, not a fresh run.
  Nine old socket-based cases remain excluded after a safety denial. Skill-sync
  catalog integration was not rerun. Independent source re-review found no
  remaining bounded-diff findings after correcting wrapper-aware inbox status.
- [x] Implement daemon-independent persistent native Off controls in source:
  FleetBar popover/Settings and pd-console control band. Save the stop state before
  requesting shutdown; show persistence errors and unverified shutdown separately.
- [ ] Enforce that state across native startup, login-shell/boot-command paths,
  client polling, CLI bootstrap, service supervision and execution admission.
- [ ] Require explicit operator re-enablement; reconnect, update, reinstall,
  repaired readiness and cleared caches must never silently reactivate work.
- [ ] Prove no-start/no-egress behavior for the exact packaged apps under an
  independently controlled offline test boundary. Collect native UI evidence only
  when the operator permits those launches.
- [ ] Reconcile local, account and global cloud automation controls in the UI.
  Local Off is not proof that hosted Fleet is off; hosted settings are not proof
  that a local shell is contained.

This safety work precedes further native Cooperative Harbor proof. The seven
Harbor delivery stages and the existing `port-daddy-unified-product-hypertree`
remain the project plan; editor foundation/history/reload PRs remain separate.

## Validation discipline

Use only named unit cases with synthetic control directories, inert CLI/Git
stand-ins and intercepted transport. Never use the unfiltered integration project:
its global setup starts a daemon. The older Coordination Guard audit cases bind
loopback sockets; their execution was denied by the safety reviewer in this pass
and is not bypassed. Preserve the operator's HOME and stop markers. Syntax checks
on installed hooks do not execute them.

The local repair adds guarded blocks; it does not replace whole custom hooks or
remove their content. The machine-specific offline Git shim delegates to the
verified `/opt/homebrew/bin/git` path. Reversing a repair means removing only the
added gate/wrapping statements, not restoring another task's entire file snapshot.

## Native/runtime publication checkpoint (2026-09-11)

FleetBar uses a filesystem-only local latch, preserves existing HALT content, syncs
the stop files and directory, and issues bounded stop/disable-only launchctl calls.
It does not invoke `pd` to stop it or touch the separate `com.bosun.daemon` project.
Its request/process adapters deny Off, and embedded dashboard navigation is cleared
when Off is observed. Account/global hosted settings remain distinct and reachable
through an explicit account link, not automatic cloud polling while locally Off.

The console stays open without a daemon endpoint, blocks automatic login-shell and
boot-command startup, drops queued automation, stops polling, and requests termination
of its owned terminal. Private local file input is retained. Its shared daemon/relay
HTTP wrapper refuses Off; this does not recall effects already accepted remotely.

TypeScript guards canonical plus selected controls before runtime imports, Dispatch,
Fleet/reload, final backend launch and supervisor start/restart. SIGHUP no longer
unconditionally resurrects Fleet after the halt watcher has latched. These checks
add denials; no new unsigned resume or marker-removal path was introduced.

Checkpoint evidence: FleetBar compiled; ten selected filesystem/fake-transport tests
passed. Console GPUI compiled before the final small packaging edits; thirteen
selected filesystem/fake-effect tests passed. TypeScript's five focused unit suites
passed 98 tests, plus two selected Fleet execution-boundary tests. Later small TS
guards need rerunning. No app, daemon, provider backend or real test socket was run.
Source/static tests are not installed-version, native visual, or independent
containment evidence. PRs are regular review requests at the operator's direction;
readiness for review is not permission to merge or activate unverified code.

### Native admission and watcher follow-up (2026-09-11)

FleetBar now registers cancellation and synchronously creates/resumes URLSession
tasks (or starts a child process) while holding the same lock used by explicit
Off. An Off request cannot miss an in-between task snapshot. Its active-effect
monitor checks external markers every 100 ms while work exists and drains those
same registrations. This is not an atomic transaction with another process's
filesystem write, nor a hard scheduling deadline.

SSE uses explicit per-task delegates and a bounded line sequence, rather than
returning an unguarded AsyncBytes stream. Reads recheck Off before and after each
await; dropping an unused stream or cancelling before headers cancels the task.
The queue holds at most 128 lines and a partial line at most 1 MiB. Overflow fails
the stream rather than silently dropping events. Cancellation of direct children
is best-effort termination, not verified process-tree shutdown or external egress
enforcement. Already-accepted remote effects cannot be recalled.

Existing CloudFleet, Interruptions, Secrets and SquidHarness transport fixtures now
inject a distinct control root alongside their intercepted session. They neither
clear canonical stop markers nor change HOME to obtain a positive control.

Appwatch and its installer embed the shared filesystem-only Off gate before
automatic work and recheck deferred phases. FleetBar's packager rechecks before
bootstrap retries, kickstart and open, including after its settle delay. Appwatch
refuses historical packagers without the guarded-launch source contract. That
contract marker is a compatibility check on trusted source, not code attestation.
No installer or hook is removed to toggle the state. The stop plan also disables
and stops appwatch, and disables both known supervised FleetBar lanes while keeping
the current control window available.

Follow-up evidence: all 84 named Swift tests pass (17 local-control cases plus
CloudFleetStore, InterruptionsStore, SecretsStore and SquidHarnessStore cases);
the full Swift package compiled. Ten watcher fixtures pass with fake service,
process and network executables, including On → Off → On and Off during a deferred
start. An already-issued bootstrap may launch via RunAtLoad; suppressing its later
kickstart does not recall that admitted effect. Native review found no concrete
P1/P2 in the bounded control/stream diff; its additional lifecycle tests were added
and passed. Watcher review found a missing post-settle check before killing the
receipt window; the fix and loaded-label regression are included. Independent
re-review found no remaining concrete P1/P2 on these bounded native/watcher surfaces.
The ten watcher cases plus 46 existing hook-gate cases pass together. Shell syntax and diff checks
pass. No app, daemon, provider, service or real network socket was started. These
are source/fixture results, not installed or independently contained runtime proof.

Remaining adversarial gates:

- Retain the limits of file-check versus effect races in shell scripts and
  already-running package-manager children; none is an external effect mediator.
- Audit other installer/resurrection paths and dynamic app lanes; do not infer
  exhaustive supervisor coverage from the named appwatch fix.
- Complete plain-JS shim parity and spawner race tests; check final
  `dispatchAgentOutputs` admission and truthful watcher compliance on stop errors.
- Obtain full final-head builds, independent review of console/runtime changes,
  packaged no-start/no-egress proof, and actual native light/dark/keyboard evidence.

Git LFS was already installed machine-wide. Repository-local filters are now
explicit, incomplete pushes are disabled, and pointer validation passes. The App
publisher uploads the LFS objects reachable from the exact publication head before
Git push even when that publication command suppresses all hooks. This is a
command-scoped halt precaution, not persistent Git configuration or the product's
On/Off mechanism. It never enables PD hooks, uses
an all-local-refs upload, or falls back to personal GitHub credentials.
