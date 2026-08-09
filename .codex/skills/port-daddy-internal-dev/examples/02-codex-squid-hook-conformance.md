# Codex Squid Hook Conformance

Use this when Codex appears wired in `~/.codex/config.toml`, but prework never
arrives, foreign locks do not block edits, or `pd squid status` says the daemon
is down while `pd status` is healthy.

## Failure pattern

Codex command hooks run inside its Seatbelt sandbox. In that environment:

- `kill -0 <daemon-pid>` and `ps` may be denied.
- TCP loopback probes may be denied even when the daemon is listening.
- asynchronous command hooks are skipped by current Codex releases.

A wrapper that gates on process inspection or localhost therefore exits before
the Squid tentacle runs. A configured `PostToolUse` hook with `async = true` is
present but inert.

## Repair contract

1. Gate hook delegation on the Bosun heartbeat at
   `~/.port-daddy/heartbeat`, not PID visibility or TCP reachability. Treat the
   heartbeat as live only within the shared 30-second freshness window.
2. Emit synchronous Codex command hooks for `UserPromptSubmit`, `PreToolUse`,
   and `PostToolUse`.
3. Replace Port Daddy's marked TOML block in place. Preserve every user-owned
   hook and unrelated config entry.
4. Keep source, staged wrappers under `~/.port-daddy/bin`, and the installed
   CLI status surface separate. An older Homebrew CLI can still report stale
   behavior after the staged wrappers are repaired.

## Proof sequence

Do not accept config inspection alone. Prove all three tentacles through an
ordinary trusted Codex session:

1. Open `/hooks`, review Port Daddy's commands, and verify the three event
   groups report active handlers.
2. Seed a unique `PD_ALERT_*` value in the Ink Cloud, submit a prompt, and
   verify the token arrives in context (`UserPromptSubmit`).
3. Seed a foreign `PD_LOCK_*`, attempt a real `apply_patch`, and verify Codex
   reports the hook's blocking reason while the file remains unchanged
   (`PreToolUse`).
4. Edit an unlocked scratch file and verify a matching `PD_PHEROMONE_*` row is
   appended (`PostToolUse`).
5. Run the focused regression suite and the shell proof:

   ```bash
   npm test -- --runInBand tests/unit/squid-harness.test.ts tests/unit/hooks-install.test.ts tests/unit/squid-identity.test.ts
   bash scripts/squid-selftest.sh
   ```

The shell proof includes eight concurrent post-tool writers. In the portable
`mkdir` lock fallback, track whether the current process already appended; do
not infer failure by checking whether the lock directory exists after release,
because a successor may already own it.

## Ship gate

Call the repair live only when prompt injection, a blocked locked edit, an
unlocked pheromone append, focused tests, and the concurrent shell selftest all
pass. Report installed-CLI freshness separately until a release promotes the
source fix.
