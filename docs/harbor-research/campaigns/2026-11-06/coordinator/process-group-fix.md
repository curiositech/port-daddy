# Hosted review P2: same-group evidence writers

The reported defect was reproduced before repair. A reviewed Python parent spawned a same-process-group child inheriting stdout/stderr, waited for the child's ready marker, and exited. The old recorder returned and sealed its evidence before the child's delayed marker and output writes. The focused test failed with:

```
AssertionError: True is not false : same-group child survived run()
```

No agent runtime or network was used. The dedicated linked root and `codex/research-program-next-result-20261106` branch were verified before edits. Only `war_room.py`, `test_war_room.py` and this note were changed. Local Port Daddy stayed halted; no commits were made.

## Repair

The direct child is launched with `start_new_session=True` as before. `waitid(WNOWAIT)` now observes its exit without reaping it. Holding that child PID keeps the owned process-group identifier from being reused while the recorder may signal the group. A fixed `/bin/ps -axo pid=,pgid=,stat=` observation reads only process identifiers and state, without arguments or environments; it must include the owned leader and contain no live same-group members before final output hashing. Zombies are already exited and cannot write.

A direct exit with live same-group descendants triggers `SIGKILL` for the owned group, followed by bounded observations until no live member remains. An execution timeout takes the same cleanup path. The recorder reconfirms child ownership before each group signal, reaps the leader only after quiescence, and never signals its numeric group after releasing that ownership anchor. A mocked lost-child-ownership test verifies that no group signal is sent after another owner has reaped the child.

Run-start records distinguish the requested execution timeout, a maximum two-second cleanup grace, the total deadline of execution timeout plus grace, and the fixed process-state probe argv. Cleanup after an early direct exit is also limited to two seconds; it cannot consume the remaining full execution budget.

Run-end preserves `exit_code` as the **actual direct child's** return code. Separate fields record `group_cleanup_forced`, `group_cleanup_reason`, `group_cleanup_seconds`, and `group_quiescent`. A direct exit 0 with terminated descendants has status `descendants-terminated`; the CLI returns 1 so cleanup is not misrepresented as ordinary successful completion. A timed-out direct child retains its signal-derived exit code and `timeout` status.

Failure to observe or stop the group leaves the run incomplete: no output hashes and no run-end are appended, and sealing fails. The failure path makes a best-effort owned-group stop and final direct-child reap, without treating that as successful group verification.

## Validation

The final regression uses a stronger handshake than a fixed delay: the descendant can attempt its marker/stdout/stderr writes only after the test creates a signal **after `run()` and `seal()` return**. After that signal, no marker appears, captured bytes remain unchanged and the external seal still verifies. This directly tests the hosted review's after-return mutation scenario.

`python3 -B scripts/harbor-research/test_war_room.py` passes **17 tests** in approximately one second. Added coverage includes the after-return writer, preserved direct failure status (7), observation failure refusing artifact binding/sealing, lost ownership refusing signals, anchored state observation with zombie exclusion, and CLI failure on forced cleanup despite direct exit 0. Existing timeout, tamper, environment and ordinary-run checks continue to pass. Scoped `git diff --check` passed.

This was locally executed on macOS. The coordinator owns the hosted Linux CI rerun and independent review. POSIX `waitid(WNOWAIT)` and the fixed `ps` observation are required; unavailable or malformed observations fail closed rather than silently weakening the rule.

## Remaining limits

This remains a host-reviewed process recorder, not a sandbox. Descendants that leave the process group, same-UID evidence rewriting, secrets, network confinement, hostile fork/escape behavior and hard host resource quotas remain outside its guarantees. Quiescence is checked against the owned group, not the entire descendant tree across new groups/sessions. A failed cleanup or observation intentionally leaves evidence unsealable; it does not promise recovery from uninterruptible processes or operator interference.

- `scripts/harbor-research/war_room.py` SHA-256: `157079cc422b74fcfb20dff8931f559fa487103f87d1a69e313a47697e1d6962`

- `scripts/harbor-research/test_war_room.py` SHA-256: `fcd7c9b59b29e14e9b222a5b7f317e4ecdc1f14bb4bb3c8c1436fa1f66338c76`
