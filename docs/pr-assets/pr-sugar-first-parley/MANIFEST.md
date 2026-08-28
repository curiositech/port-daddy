# Sugar-first Parley visual proof

These artifacts show the normal interactive arrival path, not a Porthole
recording and not a hand-composed mockup.

## What the capture proves

- A conventional `pd begin` created a durable work context with an active claim
  on `lib/sugar-parley.ts`.
- The daemon independently found a peer through the shared semantic resolver and
  verified an exact active-claim overlap on that same file.
- The human-facing card rendered **Work separately**, **Send note**, and
  **Resolve together** with its finite bounds, rather than exposing raw Parley
  performatives.
- Choosing the default human action wrote the bounded work-separately receipt.

`sugar-parley-card.png` is the frame before the decision. The companion GIF
includes the card, prompt, selection, and resulting receipt.

## Provenance

| Field | Value |
| --- | --- |
| Source label | `live-isolated-codebase-daemon` |
| Source worktree | `/Users/erichowens/.codex/worktrees/a1d5/port-daddy` |
| Source branch | `codex/sugar-first-parley` |
| Base revision at capture | `61f8dafdf` plus this uncommitted Sugar-first Parley slice |
| Daemon profile | `sugar-parley-proof-a1d5` (ephemeral, non-canonical) |
| Daemon tier | `codebase` |
| Runtime assertion | `/health` reported the same source worktree, branch, label, and non-canonical plane |
| Fixture inputs | The tape seeds a second live durable session in `/Users/erichowens/coding/tmp/sugar-parley-vhs-peer-fixture-20260827` with an exact shared claim, then the daemon selects that peer through its canonical hybrid WhoIs resolver |
| Capture tool | VHS with `FORCE_COLOR=1`, the CLI's explicit terminal-demo capability because VHS launches its child without normal terminal fds; the daemon-minted credential remained in an isolated local context and was never recorded |

The fixture intentionally never touches the canonical daemon or a Porthole
recording surface. `NO_COLOR=1` receives the same ANSI-free card and is covered
by focused tests. JSON, quiet, exported, piped, CI, and explicitly
non-interactive begin modes are separately gated and do not render or prompt
for this card.

## Reproduce

Start a named codebase berth for this worktree, then run the tape with its URL
and a fresh isolated context directory. The tape seeds the second authenticated
agent and exact shared claim noninteractively with its output suppressed; the
visible command remains the ordinary `pd begin` arrival. The capture explicitly opts into the
CLI's terminal-demo capability; normal non-TTY commands remain card-free.

```bash
env -u NO_COLOR FORCE_COLOR=1 PORT_DADDY_URL=http://127.0.0.1:<berth-port> \
  PORT_DADDY_CONTEXT_DIR=~/coding/tmp/<isolated-context> \
  vhs docs/pr-assets/pr-sugar-first-parley/sugar-parley-card.tape
```

The tape contains no credential or secret value.
