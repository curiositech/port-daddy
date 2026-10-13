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

- `https://media.portdaddy.dev/sha256/61/61625f8336d080e6d99fafdf021c3f23b5dbf136352fe59b9f4343bece346574.png`: healthy truecolor PTY at 108 columns. The daemon
  is confirmed because `/status` and `/health` agree and binary drift is false.
- `https://media.portdaddy.dev/sha256/7c/7cc94b80c3baac00a380c246e9c0c333f66f32fedf0e531e8582d49c5a9f21f0.png`: ANSI-16 PTY at 58 columns. The long Bosun
  row wraps and retains its stripe, dot, signal, and full operator truth.
- `https://media.portdaddy.dev/sha256/84/84f42bb0faf4606db242fc1257a9f19087d76dfd29fb9db42ab1ea25610254dc.png`: durable session and claim read-back from
  the named feature daemon after note and file-claim writes.
- `https://media.portdaddy.dev/sha256/f1/f10e5f091a2ec2270f1b75f67ef73d67d9712e4ea1c20a829de42f888bf6e0da.png`: refused connection with typed cause, next
  operator action, and the original nonzero exit contract.
- `https://media.portdaddy.dev/sha256/b3/b3e100c9da954b75f0fbaba0062e0f85ffb748fd5f495ba83149128b59662214.gif`: the four raw proof states sequenced for review;
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
