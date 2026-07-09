# CLI Tube Provider Registry RED/GREEN Evidence

Base for RED: `origin/main` at `fc235d501 fix(spawner): enforce hard backend budget caps (#1179)`.

Implementation branch for GREEN: `codex/cli-tube-provider-registry`, rebased onto `origin/main` `fc235d501`.

## RED

Setup:

```sh
RED_WORKTREE=$(mktemp -d /tmp/pd-cli-tube-red-current.XXXXXX)
git worktree add --detach "$RED_WORKTREE" origin/main
cp tests/unit/spawner-cli-tube-backend.test.js "$RED_WORKTREE/tests/unit/spawner-cli-tube-backend.test.js"
cp tests/unit/spawner-cli-tube-lifecycle-real-child.test.js "$RED_WORKTREE/tests/unit/spawner-cli-tube-lifecycle-real-child.test.js"
```

Command:

```sh
cd /tmp/pd-cli-tube-red-current.8MnyZi
PATH=/Users/erichowens/.nvm/versions/node/v22.17.1/bin:$PATH \
NODE_PATH=/Users/erichowens/coding/tmp/wt-cli-tube-provider-registry/node_modules \
node --experimental-vm-modules /Users/erichowens/coding/tmp/wt-cli-tube-provider-registry/node_modules/jest/bin/jest.js --runInBand tests/unit/spawner-cli-tube-backend.test.js tests/unit/spawner-cli-tube-lifecycle-real-child.test.js
```

Exit: `1`

Expected RED excerpts:

```text
FAIL unit tests/unit/spawner-cli-tube-lifecycle-real-child.test.js (7.335 s)
  cli-tube real timeout lifecycle › does not finalize a timed-out run until the CLI parent and inherited-stdio descendant are dead

    Expected: false
    Received: true

    > 127 |   expect(await isPidAlive(pid)).toBe(false);
```

```text
FAIL unit tests/unit/spawner-cli-tube-backend.test.js
  Test suite failed to run

    TypeError: Cannot read properties of undefined (reading 'filter')

    > 309 |   test.each(CLI_TUBE_TOOLS.filter((tool) => tool !== 'codex'))(
```

```text
Test Suites: 2 failed, 2 total
Tests:       1 failed, 1 total
EXIT=1
```

Why this is expected RED:

- `origin/main` has no public typed cli-tube provider registry exports, so current registry/runtime-policy tests cannot even enumerate providers.
- `origin/main` finalizes timeout handling before proving the inherited-stdio descendant is dead, reproducing Carson/Faraday's lifecycle bug with a real process.

## Earlier Hard-Deadline RED

After the first lifecycle cleanup removed the unsafe forced settle, manager review caught the opposite risk: a child that never emits `close` after `SIGKILL` could hang forever. The hard-deadline test was added before the bounded deadline implementation and failed as expected:

```sh
PATH=/Users/erichowens/.nvm/versions/node/v22.17.1/bin:$PATH npm test -- --runInBand tests/unit/spawner-cli-tube-backend.test.js -t "timeout hard-deadline resolves failed"
```

```text
FAIL unit tests/unit/spawner-cli-tube-backend.test.js
  spawnViaCliTube — failure paths › timeout hard-deadline resolves failed if SIGKILL never produces close, without destroying streams

    Expected: true
    Received: false

    > 749 |       expect(settled).toBe(true);
```

## Noether Orphaned-Descendant RED

Noether's DO-NOT-SHIP blocker identified a distinct lifecycle leak: the CLI parent can exit before the timeout while a detached inherited-stdio descendant keeps stdout/stderr open. This RED was run after adding only the new real-process regression to the #1334 branch, before lifecycle production changes.

Command:

```sh
PATH=/Users/erichowens/.nvm/versions/node/v22.17.1/bin:$PATH npm test -- --runInBand tests/unit/spawner-cli-tube-lifecycle-real-child.test.js
```

Exit: `1`

Expected RED excerpt:

```text
> port-daddy@3.24.2 test
> node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/unit/spawner-cli-tube-lifecycle-real-child.test.js

FAIL unit tests/unit/spawner-cli-tube-lifecycle-real-child.test.js (12.994 s)
  cli-tube real timeout lifecycle
    ✓ does not finalize a timed-out run until the CLI parent and inherited-stdio descendant are dead (5460 ms)
    ✕ kills an inherited-stdio descendant even when the CLI parent exits before timeout (7459 ms)

  ● cli-tube real timeout lifecycle › kills an inherited-stdio descendant even when the CLI parent exits before timeout

    expect(received).toBe(expected) // Object.is equality

    Expected: false
    Received: true

      153 |     await new Promise((resolve) => setTimeout(resolve, 50));
      154 |   }
    > 155 |   expect(await isPidAlive(pid)).toBe(false);
          |                                 ^
      156 | }

Test Suites: 1 failed, 1 total
Tests:       1 failed, 1 passed, 2 total
```

## Real-Child Process-Tree Shape

The real-child test installs a fake `agy` binary. cli-tube launches that fake binary with `detached: true`, making the CLI parent its own process-group leader. The fake CLI records its parent PID, then starts a survivor process with `detached: true` and `stdio: ['ignore', 'inherit', 'inherit']`. That survivor has its own process group, but it inherits cli-tube's stdout/stderr pipes, so Node should not honestly emit `close` until the survivor exits or those pipes close.

Process-group signaling alone cannot kill this survivor because it moved into a separate process group. The first real-child test keeps the parent alive long enough for process-tree collection to discover the descendant with `ps -axo pid=,ppid=`. The Noether regression makes the parent exit immediately after spawning the survivor, so the fix also discovers processes that still hold the child stdout/stderr fds: `/proc/<pid>/fd` targets on Linux-style systems and unix-socket peer endpoints with `lsof -nP -U` on macOS-style systems. The survivor ignores `SIGTERM`, so both tests only go green if the shared lifecycle helper escalates and kills the actual descendant before finalization.

## GREEN

Command:

```sh
PATH=/Users/erichowens/.nvm/versions/node/v22.17.1/bin:$PATH npm test -- --runInBand tests/unit/spawner-cli-tube-backend.test.js tests/unit/spawner-cli-tube-lifecycle-real-child.test.js tests/unit/spawner-cli-agy-transcript.test.js tests/unit/spawner-cli-tube-observability.test.js tests/unit/cli-tube-backends-launch.test.js tests/unit/spawner-transcripts.test.js tests/unit/spawner-budget-cap.test.js tests/unit/spawn-routes-preflight.test.js tests/unit/spawn-status-contract.test.js
```

Exit: `0`

```text
Test Suites: 9 passed, 9 total
Tests:       157 passed, 157 total
Snapshots:   0 total
Time:        20.727 s
```

Command:

```sh
PATH=/Users/erichowens/.nvm/versions/node/v22.17.1/bin:$PATH npm run typecheck -- --noEmit
```

Exit: `0`

```text
> port-daddy@3.24.2 typecheck
> tsc --noEmit --noEmit
```

Command:

```sh
git diff --check
```

Exit: `0`

Output: empty.

## Why These Tests Are Not Tautologies

- The real-child test uses real OS processes and inherited stdout/stderr. It fails if cli-tube reports completion before both the CLI parent and its inherited-stdio descendant are dead.
- The Noether real-child regression makes the CLI parent exit before timeout, which means parent-process-tree lookup alone cannot find the detached inherited-stdio survivor. It fails unless lifecycle finalization kills the actual holder of the stdout/stderr pipes.
- The hard-deadline tests keep stdout/stderr pipes open, force the child never to emit `close`, and assert a failed timeout result without stream destruction or leaked `data` listeners.
- The process-tree fallback test forces `ps` to fail, verifies the bounded `maxBuffer` call shape, checks root-pid `SIGTERM`/`SIGKILL` fallback signaling, and requires the final error to disclose the fallback.
- The provider behavior tests run through `spawnViaCliTube`, not just registry shape: provider auth guidance appears in runtime auth failures, placeholder model policy changes actual argv, Codex alone uses `--output-last-message`, non-Codex providers do not receive the output path, binary preflight returns exit 127 without spawning, and agy empty-success failure does not contaminate claude-code/codex/gemini/groq/grok.
- TypeScript derives `CliTubeTool` and `CLI_TUBE_TOOLS` from `CLI_TUBE_PROVIDER_SPECS`; a missing provider spec or unhandled arg style fails at typecheck instead of relying on duplicated provider strings.
