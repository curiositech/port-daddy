# Example Output: Agent Control Command Contract

Scenario: a control-panel team ships a single generic `control` verb that covers interrupt/pause/kill for local same-UID bodies, adds `steer`/`checkpoint`/`fork` as separate verbs, but authorizes every command from the cached roster projection the session list already renders — because that's the data that's already in memory. An observed-only backend is wired in without ever declaring what it can't do.

## Weak spec — input

```json
{
  "verbs": [
    { "name": "control", "terminalStates": ["queued", "delivered"] },
    { "name": "steer", "terminalStates": ["queued", "delivered", "acknowledged", "failed", "expired"] },
    { "name": "checkpoint", "terminalStates": ["queued", "delivered", "acknowledged", "failed", "expired", "unsupported"] },
    { "name": "fork", "terminalStates": ["queued", "delivered", "acknowledged", "failed", "expired", "unsupported"] }
  ],
  "backends": [
    { "name": "local-same-uid", "supportedVerbs": ["control", "steer", "checkpoint", "fork"] },
    { "name": "hook-only-observed", "supportedVerbs": [] }
  ],
  "authorizationSource": "cached-projection",
  "matrix": [
    { "verb": "control", "backend": "local-same-uid", "hasDistinctTerminalStates": true },
    { "verb": "control", "backend": "hook-only-observed", "hasDistinctTerminalStates": false },
    { "verb": "steer", "backend": "local-same-uid", "hasDistinctTerminalStates": true },
    { "verb": "steer", "backend": "hook-only-observed", "hasDistinctTerminalStates": true },
    { "verb": "checkpoint", "backend": "local-same-uid", "hasDistinctTerminalStates": true },
    { "verb": "checkpoint", "backend": "hook-only-observed", "hasDistinctTerminalStates": true },
    { "verb": "fork", "backend": "local-same-uid", "hasDistinctTerminalStates": true },
    { "verb": "fork", "backend": "hook-only-observed", "hasDistinctTerminalStates": true }
  ]
}
```

## Weak spec — audit result

```json
{
  "pass": false,
  "score": 40,
  "findings": [
    {
      "severity": "critical",
      "id": "authorizes-from-stale-projection",
      "message": "authorizationSource is \"cached-projection\" — a control command would be authorized from a projection or UI state that can be stale, corrupted, or frozen, not authoritative daemon truth."
    },
    {
      "severity": "critical",
      "id": "collapsed-verbs",
      "message": "Verb set is missing distinct claim(s) for: interrupt, pause, kill. interrupt, pause, kill, and steer each have different runtime truth and must not be merged into a single generic \"stop\" or \"control\" claim."
    },
    {
      "severity": "critical",
      "id": "verb-missing-terminal-states",
      "message": "Verb \"control\" is missing required terminal state(s): acknowledged, failed, expired. A verb without the full delivered/acknowledged/failed/expired set cannot distinguish \"sent\" from \"actually happened\" from \"gave up.\""
    },
    {
      "severity": "critical",
      "id": "backend-verb-no-unsupported-state",
      "message": "Backend \"hook-only-observed\" does not support verb \"control\" but has no proven \"unsupported\" terminal for that pair (matrix cell exists but is not distinct or verb lacks \"unsupported\")."
    },
    {
      "severity": "critical",
      "id": "backend-verb-no-unsupported-state",
      "message": "Backend \"hook-only-observed\" does not support verb \"steer\" but has no proven \"unsupported\" terminal for that pair (matrix cell exists but is not distinct or verb lacks \"unsupported\")."
    }
  ],
  "recommendations": [
    "Re-check authoritative lease/event state (an appended control_commands event or an active lease record) at the moment of authorization; a pane may display stale data, but a command must never be authorized from it.",
    "Add a separate verb entry (with its own terminalStates) for each of: interrupt, pause, kill.",
    "Add acknowledged, failed, expired to verb \"control\"'s terminalStates.",
    "Add \"unsupported\" to verb \"control\"'s terminalStates and a matrix cell for (\"control\", \"hook-only-observed\") with hasDistinctTerminalStates:true, so the control panel disables that combination honestly instead of hiding it.",
    "Add \"unsupported\" to verb \"steer\"'s terminalStates and a matrix cell for (\"steer\", \"hook-only-observed\") with hasDistinctTerminalStates:true, so the control panel disables that combination honestly instead of hiding it."
  ]
}
```

## What fixing it actually looked like

1. **Split the generic `control` verb** into `interrupt`, `pause`, and `kill`, each with its own full terminal-state lifecycle — the daemon-side adapter had to actually track pause's "no tools executing" fact separately from kill's "process is dead" fact, not just rename one status field.
2. **Wired authorization to the lease table**, not the roster projection the session list reads. The roster projection can still go stale for display purposes; the command handler now re-resolves the target lease before delivering anything.
3. **Added `unsupported` to every verb's terminal states** and proved it with a real probe against the `hook-only-observed` backend: an interrupt attempt against an observed import now returns `unsupported` immediately instead of hanging or silently no-op'ing.
4. **Added a Cloudflare remote backend** to the matrix to prove the same discipline holds for a body that supports some verbs (`steer`, `interrupt`, `kill`, `checkpoint`) but not others (`pause`, `fork`).

## Fixed spec — input

This is `examples/sample-input.json`, unmodified:

```json
{
  "verbs": [
    { "name": "steer", "terminalStates": ["queued", "delivered", "acknowledged", "failed", "expired", "unsupported"] },
    { "name": "interrupt", "terminalStates": ["queued", "delivered", "acknowledged", "failed", "expired", "unsupported"] },
    { "name": "pause", "terminalStates": ["queued", "delivered", "acknowledged", "failed", "expired", "unsupported"] },
    { "name": "kill", "terminalStates": ["queued", "delivered", "acknowledged", "failed", "expired", "unsupported"] },
    { "name": "checkpoint", "terminalStates": ["queued", "delivered", "acknowledged", "failed", "expired", "unsupported"] },
    { "name": "fork", "terminalStates": ["queued", "delivered", "acknowledged", "failed", "expired", "unsupported"] }
  ],
  "backends": [
    { "name": "local-same-uid", "supportedVerbs": ["steer", "interrupt", "pause", "kill", "checkpoint", "fork"] },
    { "name": "cloudflare-remote", "supportedVerbs": ["steer", "interrupt", "kill", "checkpoint"] },
    { "name": "hook-only-observed", "supportedVerbs": [] }
  ],
  "authorizationSource": "authoritative-lease",
  "matrix": "... 18 cells, one per verb x backend, every one hasDistinctTerminalStates:true — see examples/sample-input.json for the full array"
}
```

## Fixed spec — audit result

```json
{
  "pass": true,
  "score": 100,
  "findings": [],
  "recommendations": [
    "Contract meets the control-command bar: authorization reads authoritative state, every verb is a distinct claim with a full terminal-state lifecycle, and every backend is honest about what it cannot do. Safe to render these controls as clickable."
  ]
}
```

Note that `cloudflare-remote` still cannot perform `pause` or `fork` — that's fine and expected. The fix isn't "every backend supports every verb," it's "every combination, supported or not, is provably distinct and honestly labeled."
