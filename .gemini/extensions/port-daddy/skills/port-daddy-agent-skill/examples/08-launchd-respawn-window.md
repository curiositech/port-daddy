---
title: "Example 08: The launchd respawn window"
purpose: "Why CLI calls used to flake during stable promotion, and how pdFetch retry absorbs it."
last_verified: 2026-04-30
incident_date: 2026-04-29
fixed_in_commit: d312c87
---

# The launchd Respawn Window

## What the user saw

> "Fucking fix the daemon, dude, it's obviously broken"

The CLI would intermittently fail with `daemon not running` even though `pd status` worked seconds before. The pattern was random. Crash logs were empty. The daemon was alive when checked manually.

## What was actually happening

`promote-stable.sh` issues a clean `SIGTERM` to the running daemon. launchd's `KeepAlive` directive respawns it. The respawn takes ~1 second. During that ~1s window, every CLI call hits a closed socket and gets `ECONNREFUSED`.

```
T+0.000s   promote-stable.sh sends SIGTERM
T+0.020s   daemon writes shutdown record, closes connections
T+0.150s   socket file unlinked, port released
T+0.200s   launchd notices, schedules respawn        ← CLI call HERE = fail
T+0.800s   new daemon process starts                 ← CLI call HERE = fail
T+1.100s   socket file recreated, port bound         ← CLI call HERE = success
T+1.200s   /health green
```

The CLI had no retry. The user saw the gap as flake.

## How to detect this in your own incident

Run, in this order:

```bash
# Is launchd controlling the daemon?
launchctl list | grep portdaddy
# If "PID -" appears in column 1, it's mid-respawn.

# Recent SIGTERMs from the daemon's logs
grep -i "sigterm\|graceful shutdown\|exit" /Users/erichowens/coding/port-daddy/port-daddy.log | tail -20

# Is promote-stable.sh running RIGHT NOW?
ps aux | grep promote-stable | grep -v grep

# Cross-reference with stable's HEAD vs main
git -C ~/port-daddy-stable log --oneline -1
git -C ~/coding/port-daddy log --oneline origin/main -1
```

If a recent SIGTERM correlates with promote-stable activity, you're seeing the respawn window — not a real outage.

## How the fix works

`cli/utils/fetch.ts` now retries on `ECONNREFUSED` and `ENOENT` with exponential backoff: `[200, 400, 800, 1500]ms`. Total budget ~2.9s — comfortably absorbs the ~1s respawn.

```typescript
const DAEMON_RECONNECT_DELAYS_MS: readonly number[] = [200, 400, 800, 1500];

function isDaemonDownError(error: unknown): boolean {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as any).code) : '';
  return code === 'ECONNREFUSED' || code === 'ENOENT';
}

// In pdFetch:
for (let attempt = 0; attempt <= delays.length; attempt += 1) {
  try { return await singleRequest(path, options); }
  catch (error) {
    if (!isDaemonDownError(error) || attempt === delays.length) throw error;
    await new Promise(r => setTimeout(r, delays[attempt]));
  }
}
```

Other errors (timeouts, 5xx, ECONNRESET) still fail fast — those mean a different problem than "daemon temporarily down."

## Disabling the retry

For tests, debugging, or pointing at a known-dead remote daemon:

```bash
PORT_DADDY_NO_RETRY=1 pd status
```

## Lessons

- **A 1s window is invisible to humans but always-visible to CLI tools.** Backoff that wraps that window is much cheaper than restructuring the daemon lifecycle.
- **Don't retry indiscriminately.** ECONNREFUSED + ENOENT are "process gone, will be back." ECONNRESET, timeouts, and 5xx are different problems and shouldn't retry.
- **The user-visible flake was fixed without touching the daemon.** The bug was in the CLIENT's resilience model, not the server.
- **Test the retry loop with mocked time.** See `tests/unit/cli-fetch.test.js` for the pattern: mock `http.request`, count attempts, verify the budget.

## Related

- `cli/utils/fetch.ts:139` — `DAEMON_RECONNECT_DELAYS_MS`
- `tests/unit/cli-fetch.test.js` — retry-loop tests
- `decisions/something-broke.md` — broader "is the daemon really down?" tree
