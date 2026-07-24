# CLI Story-Linework Runtime Proof

Captured from the compiled branch binary against the isolated codebase berth
`cli-linework` at `http://127.0.0.1:3180`. The proof daemon is PID `30119`,
revision `e2b495ec0`, source directory
`/Users/erichowens/coding/tmp/port-daddy-dispatch-be996b1f`, and state plane
`ephemeral:cli-linework`.

The daemon was rebuilt and launched through `pd dev up`, not the generic profile
launcher or Homebrew `pd`. `/health` reports `tier: codebase`,
`label: cli-linework`, `canonical: false`, the exact source directory and Git
revision, and matching running/on-disk daemon hashes:
`f021c85cf97a0c9848a4665233c75f9d3065778311a29a6ae58f415134a80d81`.
The compiled CLI hash is
`d98aeef749b74072d4466ad6e7176a63cd58b31ef944e599e90bddb89abd68b9`.

This is not fixture output. `pd begin`, `pd note`, `pd session files add`,
`pd sessions`, and `pd status` were executed against the feature daemon. The
durable proof session is
`session-prove-story-linework-against-the-named-cli-daemo-340460946fda`.

## Visual Matrix

- `status-truecolor-proof.png`: healthy truecolor PTY at 108 columns. The daemon
  is confirmed because `/status` and `/health` agree and binary drift is false.
- `status-16color-narrow-proof.png`: ANSI-16 PTY at 58 columns. The long Bosun
  row wraps and retains its stripe, dot, signal, and full operator truth.
- `sessions-feature-daemon-proof.png`: durable session and claim read-back from
  the named feature daemon after note and file-claim writes.
- `status-daemon-down-proof.png`: refused connection with typed cause, next
  operator action, and the original nonzero exit contract.
- `story-linework-runtime.gif`: the four raw proof states sequenced for review;
  it is not simulated application motion.
- `status-no-color.txt`: `NO_COLOR` inside a PTY, with no ANSI decoration.
- `status-piped.txt`: non-TTY plain-output contract.
- `status.json`: healthy, codebase-berth machine contract from PID `30119`.
- `status-daemon-down.json`: structured `DAEMON_UNAVAILABLE` contract captured
  against unused port `65431`; the command exited `1`.

The `.ansi` files are raw PTY captures. The HTML and PNG files are rendered
from those captures; no state or text is rewritten between capture and image.

## Validation

- Ten focused Jest suites passed: 384 tests and one inline snapshot.
- `tsc --noEmit` passed under Node 22.17.1.
- The Bun CLI and daemon binaries compiled successfully.
- Responsive and daemon-down JSON outputs passed direct `jq` inspection.
- The named daemon reports severity `ok` and `binaryDrift.drifted: false`.
- A global `--daemon http://127.0.0.1:3180` command read feature-daemon state
  while canonical daemon PID `96392` remained unchanged.

The host's default Node 25 cannot load the existing Node-22 ABI build of
`better-sqlite3`; the focused matrix therefore runs with the installed Node
22.17.1 runtime. This is an environment compatibility fact, not a skipped test.
