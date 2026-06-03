# Fleet — Known Issues

Living list of fleet-system rough edges discovered during the
2026-05-20 restart. Each entry needs a real fix; until then this is the
honest crib sheet for operators.

## 1. `pd fleet up` / `pd fleet status` are CWD-anchored, daemon truth is not

**Symptom.** Run `pd fleet up` from the main repo working tree → it writes
`<repo>/.portdaddy/fleet-state.json` with the daemon PID and the fleet starts.
Run `pd fleet status` from any worktree of that same repo → reports
*"Fleet 'port-daddy' defined in pd-fleet.yml but not running."*

**Root cause.** `cli/commands/fleet.ts` reads/writes
`join(process.cwd(), '.portdaddy', 'fleet-state.json')` everywhere. Worktrees
have their own `.portdaddy/` and the file isn't there, so the CLI thinks the
fleet is dry-docked. Meanwhile the daemon, which is the actual source of
truth (`fleetDaemon.getStatus()` via `GET /fleet`), is running the ships
correctly.

**Workaround.** Trust the HTTP API, not the CLI, when working from a worktree:

```bash
curl -fsS http://localhost:9876/fleet | python3 -m json.tool
curl -fsS http://localhost:9876/fleet/<project> | python3 -m json.tool
```

The dashboard `Agents` surface also reads from the daemon and shows real status.

**Fix idea.** Have the CLI prefer the daemon's `/fleet` response when one is
reachable, and fall back to the local state file only when offline. The local
`fleet-state.json` should be a hint, not a record.

## 2. There is no CLI flag for "start a subset of the configured ships"

**Symptom.** `pd-fleet.yml` declares eight agents. We wanted to enable five and
leave three paused at startup. `pd fleet up` has no `--only`/`--enable` flag —
it brings them all up.

**Workaround.** Use the daemon API, which already supports `enabledAgents`:

```bash
curl -fsS -X POST http://localhost:9876/fleet/start \
  -H 'Content-Type: application/json' \
  -d '{"projectDir":"<absolute path>","enabledAgents":["a","b","c"]}'
```

Or pause individual ships post-startup via `POST /fleet/agent/pause`.

**Fix idea.** Plumb `--only <name>` (repeatable) or `--enable <list>` through
to `fleetDaemon.startProject({ enabledAgents })`. Mirror in `pd fleet status`
so paused-by-default ships render as `[paused (deferred)]` rather than just
`[paused]`.

## 3. Stale `fleet-state.json` files survive `pd fleet down`

**Symptom.** The main repo's `.portdaddy/fleet-state.json` from a previous
session (PID 43446, started 09:46) was still present when we restarted.
`pd fleet up` from that directory says "Fleet already running" even when the
PID is dead.

**Workaround.** `pd fleet down` removes it. Or `rm
<repo>/.portdaddy/fleet-state.json` and retry.

**Fix idea.** Replace the PID-in-a-json-file pattern with a daemon liveness
check: if the daemon answers `/fleet/<project>` and reports `running: true`,
trust that; otherwise treat any state file as stale.

## 4. `pd fleet status` shows runtime defaults as "(unset)" even when agents pin them

Cosmetic, not load-bearing — but every agent in our `pd-fleet.yml` pins
`backend: cloudflare` + an explicit `model:`, yet the "Fleet runtime defaults"
line prints `backend: (unset) / model: (unset)`. That's technically correct
(no fleet-wide default is declared) but visually suggests the fleet is
mis-configured. Worth a copy tweak: "no fleet-wide default (each agent pins
its own)".
