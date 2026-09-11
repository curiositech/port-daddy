# Local Off: implementation and evidence

Status: hook admission implemented; complete application/runtime Off is unfinished.
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
The redundant repository SessionStart `pd attention` command is removed.

Off skips the Port Daddy block in a merged hook, not unrelated user commands.
The checked-in publisher preserves Git LFS. A disabled Git shim delegates to real
Git without calling the CLI or writing Port Daddy audit records. Turning off
coordination is not permission to bypass GitHub branch protection or other tools.

An installed scoped publisher is not necessarily current. Old custom publishers
without the exact gate are reported as needing review, not silently overwritten
or falsely reported upgraded. Installing source is separate from repairing copies
already staged on a machine. No installer in this slice clears the stop marker.

These are cooperative product gates, not hostile-code containment. They do not
revoke already-running processes, atomically mediate effects after admission, or
prove that an arbitrary same-user process cannot read credentials. Drydock's
external execution boundary is still proposed; no whole-app zero-spend claim is
made here.

## Off-control task list

- [x] Inventory source and installed Git/harness entry points without running them.
- [x] Gate managed Git guards, shim and publishing templates before invocation.
- [x] Gate Pilot steering/networking and remove the direct attention hook.
- [x] Gate automatic post-merge console rebuilding.
- [x] Repair this operator's identified installed Git hooks, Git shim, stale
  pre-compaction pair and Pilot script; preserve unrelated hook bodies.
- [x] Complete adversarial regression validation and publish hook PR #10137:
  149 tests pass; nine old socket-based cases remain excluded after a safety
  denial. Independent source re-review found no remaining bounded-diff findings.
- [ ] Implement a daemon-independent, persistent local Off button. Write the
  stop state before requesting shutdown; display partial failure honestly.
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
