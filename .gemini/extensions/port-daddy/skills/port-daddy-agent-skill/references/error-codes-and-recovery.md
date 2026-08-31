# Error Codes and Recovery

A map from observable Port Daddy errors to the recovery action that actually works. This is a reference, not a tutorial — look up your symptom, follow the recipe.

## Daemon errors

### `ECONNREFUSED` connecting to daemon

**Cause options:**

1. Daemon process dead.
2. Daemon mid-respawn from launchd (~1s window after SIGTERM).
3. Wrong port/socket path.

**Recovery:**

```bash
launchctl list | grep portdaddy           # is launchd controlling it?
ps -p $(launchctl list | grep portdaddy | awk '{print $1}')   # is the PID alive?
ls ~/.port-daddy/daemon.sock              # socket present?
cat ~/.port-daddy/daemon.port             # what port?
```

If launchd shows a running PID and socket exists: probably mid-respawn, retry once.
If neither: `launchctl kickstart -k gui/501/com.portdaddy.daemon`.

If still dead: read `port-daddy.log` for the actual crash.

**Auto-handled:** since `d312c87`, `pdFetch` retries with `[200, 400, 800, 1500]ms` backoff for ECONNREFUSED + ENOENT. See `examples/08-launchd-respawn-window.md`.

### `ENOENT` for socket file

Same as ECONNREFUSED — daemon mid-startup or genuinely down. Same recovery.

### `EPERM` accessing socket

Permissions drift on `~/.port-daddy/`. Run `pd install` to fix the socket directory permissions. Do NOT `chmod 777` — the daemon enforces tight perms for security.

### `EADDRINUSE` on port 9876

Something else (or another daemon) holds the port.

```bash
lsof -i :9876
```

If it's another `port-daddy` PID: stop the redundant one (`pd stop` if reachable, else `kill <pid>`).
If it's something else: pick a different port via `PORT_DADDY_PORT` env, or evict the other process.

## Coordination Guard errors

### "No active session attached to this shell"

**Cause:** the `.portdaddy/contexts/<slot>.json` for this shell's cwd doesn't exist or doesn't reference an active session.

**Recovery:**

```bash
# Are you in the right cwd?
pwd
ls .portdaddy/contexts/

# Begin a session HERE (in this cwd, in this shell):
pd begin "<task>" --identity <project>:<task> --lifecycle durable --roadmap <same-slug>
```

The session is per-cwd. If you ran `pd begin` from `/Users/x/repo` then `cd` into `/Users/x/repo/sub`, the context is still resolvable — but if you `cd` to a different worktree, you need a fresh `pd begin` there.

### "File X is not claimed by the active session"

**Recovery:**

```bash
# Claim everything you're staging:
git diff --cached --name-only | while read f; do
  pd session files claim "$f"
done
```

If a file is claimed by a DIFFERENT active session: that's a real conflict. STOP and message that session's actor before proceeding.

If a file is claimed by a DEAD session (look up the agent in `pd whoami` — `isActive: false`): claim the file via salvage:

```bash
pd salvage claim <session-id-of-dead-claimant>
```

### "Session belongs to agent X, not cli-Y"

**Cause:** you're trying to act on a session that belongs to a different process. Each `pd begin` binds the session to the process that called it.

**Recovery:** start a fresh session in this shell, OR pass `--agent` and `--session` explicitly to override (use sparingly).

## Test errors

### `NODE_MODULE_VERSION 141 vs 127` (or any mismatch)

**Cause:** native module compiled against a different Node ABI than your current Node.

**Recovery:**

```bash
npm rebuild better-sqlite3      # or whatever module is reported
```

See `examples/09-better-sqlite3-abi-rebuild.md` for the full backstory.

### `tuples-delivery.test.js` "Cannot read properties of undefined (reading 'destroy')"

This used to be a real failure (test factory missing `destroy`). On `origin/main` as of 2026-04-30, it's fixed. If you see it: your local checkout is stale; `git fetch && git rebase origin/main`.

## Spawn / Fleet errors

### "Backend not configured" when spawning

**Cause:** the persona's `backend:` field references a backend you don't have credentials for.

**Recovery:**

- For `claude-cli`: ensure `claude` is on PATH and authenticated.
- For `codex`: ensure OpenAI credentials are set.
- For `aider` / others: check the backend's own setup.

`pd spawn --list-backends` to see what's available.

### "Schedule conflict: multiple agents with same identity"

**Cause:** `pd-fleet.yml` has two entries with the same `identity`.

**Recovery:** rename one. Identities are unique keys.

### Forked sub-agent never returned

**Cause:** crashed, timed out, or got stuck on a coordination block.

**Recovery:** see `subagent-fork/rejoin-protocol.md` "Incomplete sub-agent."

## Salvage errors

### Salvage queue is huge (>200 entries)

**Cause:** agents have been crashing; queue isn't being drained.

**Recovery:**

```bash
pd salvage --limit 50              # read it
# Triage manually OR spawn a salvage-watcher:
pd spawn --backend claude-cli \
  --persona skills/port-daddy-agent-skill/agents/salvage-watcher.yaml \
  --foreground
```

### Salvage entry references files that no longer exist

**Cause:** the file was deleted after the dead agent claimed it.

**Recovery:** dismiss the salvage entry (`pd salvage dismiss <id>` if available) or claim it and immediately drop a `pd note` recording that the work is moot.

## Git errors

### "Your branch is ahead of origin by N commits" but you didn't commit

**Cause:** another agent committed in this worktree.

**Recovery:** see `examples/10-walked-into-anothers-rebase.md`. Don't push. Investigate.

### "Interactive rebase in progress" when you didn't start one

**Cause:** another agent's mid-rebase state. See same example.

### "Coordination Guard refused commit" but session looks active

**Cause:** session anchor is for a different cwd.

**Recovery:**

```bash
cd <correct-worktree>
pd whoami           # confirm session is here
pd begin ... --lifecycle durable --roadmap <same-slug>  # if not, start one HERE
```

## Skill / mirror errors

### "Skill not found" when MCP / IDE loads

**Cause:** the user-scope mirror (`~/.agents/skills/port-daddy`, `~/.claude/skills/port-daddy`) is broken or missing.

**Recovery:**

```bash
pd setup            # re-installs symlinks for the canonical skill
ls -la ~/.claude/skills/port-daddy
# Should be a symlink to the repo's skills/port-daddy-agent-skill/
```

### Tests fail: "skills/port-daddy-cli/SKILL.md should not exist"

**Cause:** the deprecated `port-daddy-cli` skill directory exists locally but shouldn't (it was eradicated). Probably from a stale branch.

**Recovery:** `git fetch && git rebase origin/main`.

## When the symptom isn't here

1. Search this file again with the literal error string.
2. Check `decisions/something-broke.md` for branching diagnosis.
3. Check `pd notes --limit 50` for active fleet context.
4. Check `git log origin/main` — your error may be already fixed upstream.
5. If new: file an entry here as part of your fix PR. Future-you will be grateful.

## Related

- `decisions/something-broke.md` — branching diagnosis tree.
- `examples/08-launchd-respawn-window.md` — the daemon-down ECONNREFUSED case.
- `examples/09-better-sqlite3-abi-rebuild.md` — the cascade-failure case.
- `recovery-and-salvage.md` — full salvage workflow.
