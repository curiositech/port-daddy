# CLI Tube Provider Registry RED/GREEN Evidence

Base for latest RED/GREEN: `origin/main` at `dcf422dea test(spawner): cover direct API provider transcripts (#1370)`.

Implementation branch for GREEN: `codex/cli-tube-provider-registry`, rebased onto `origin/main` `dcf422dea`.

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

Noether's DO-NOT-SHIP blocker identified a distinct lifecycle leak: the CLI parent can exit before the timeout while a detached inherited-stdio descendant keeps stdout/stderr open. Ubuntu CI confirmed the parent-exits orphan case was still leaking before this fix:

```text
FAIL tests/unit/spawner-cli-tube-lifecycle-real-child.test.js
cli-tube real timeout lifecycle › kills an inherited-stdio descendant even when the CLI parent exits before timeout
Expected isPidAlive(pid) false, received true at line 155
job 86210211135, run 29044664202
```

The local macOS real-child test passed even under `PATH=/usr/bin:/bin`, so the new local RED forces the exact missing-holder branch with mocked `lsof`: bare `lsof` is ENOENT, process-tree lookup only sees the root PID, and the inherited-stdio holder is visible only through a known absolute lsof path. This test was added before the resolver/lifecycle implementation.

Command:

```sh
npm test -- --runInBand tests/unit/spawner-cli-tube-backend.test.js -t "timeout discovers inherited stdio holders through known lsof paths when PATH omits lsof"
```

Exit: `1`

Expected RED excerpt:

```text
> port-daddy@3.24.2 test
> node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/unit/spawner-cli-tube-backend.test.js -t timeout discovers inherited stdio holders through known lsof paths when PATH omits lsof

FAIL unit tests/unit/spawner-cli-tube-backend.test.js
  spawnViaCliTube — failure paths › timeout discovers inherited stdio holders through known lsof paths when PATH omits lsof

    expect(jest.fn()).toHaveBeenCalledWith(...expected)

    Expected: 6161, "SIGTERM"
    Received
           1: -5151, "SIGTERM"
           2: 5151, "SIGTERM"

    > 884 |       expect(processKill).toHaveBeenCalledWith(holderPid, 'SIGTERM');

Test Suites: 1 failed, 1 total
Tests:       1 failed, 94 skipped, 95 total
```

After the absolute-`lsof`/remembered-stdio fix, Ubuntu CI still failed the real-child parent-exits case at the survivor assertion:

```text
FAIL tests/unit/spawner-cli-tube-lifecycle-real-child.test.js (13.547 s)
  cli-tube real timeout lifecycle › kills an inherited-stdio descendant even when the CLI parent exits before timeout

Expected: false
Received: true

> 105 |     await expectPidDead(survivorPid);
```

That showed a second hole: lifecycle killed the discovered stdio holder/launcher, but did not snapshot the holder's child process tree before the holder died and its child orphaned. The unit regression was tightened before the second lifecycle fix:

```sh
npm test -- --runInBand tests/unit/spawner-cli-tube-backend.test.js -t "timeout discovers inherited stdio holders through known lsof paths when PATH omits lsof"
```

Exit: `1`

```text
FAIL unit tests/unit/spawner-cli-tube-backend.test.js
  spawnViaCliTube — failure paths › timeout discovers inherited stdio holders through known lsof paths when PATH omits lsof

Expected: 7171, "SIGTERM"
Received
       1: -5151, "SIGTERM"
       2: 5151, "SIGTERM"
       3: 6161, "SIGTERM"

> 893 |       expect(processKill).toHaveBeenCalledWith(holderDescendantPid, 'SIGTERM');
```

After that fix, Ubuntu CI still failed the parent-exits case on head `811266687`:

```text
FAIL tests/unit/spawner-cli-tube-lifecycle-real-child.test.js
cli-tube real timeout lifecycle › kills an inherited-stdio descendant even when the CLI parent exits before timeout
Expected: false
Received: true
> 105 |     await expectPidDead(survivorPid);
unit-tests (ubuntu-latest, 22), job 86216805202, run 29046631323
```

The next RED added two focused assertions before implementation: typoed providers must fail as structured spawn results, and stdio holder descendants must be signaled by process group as well as by PID.

```sh
npm test -- --runInBand tests/unit/spawner-cli-tube-backend.test.js -t "unknown CLI tool|timeout discovers inherited stdio holders"
```

Exit: `1`

```text
FAIL unit tests/unit/spawner-cli-tube-backend.test.js
  spawnViaCliTube — failure paths › unknown CLI tool fails gracefully before child execution

    unknown cli tool: cli:typo

  spawnViaCliTube — failure paths › timeout discovers inherited stdio holders through known lsof paths when PATH omits lsof

    Expected: -6161, "SIGTERM"
    Received
           1: -5151, "SIGTERM"
           2: 5151, "SIGTERM"
           3: 6161, "SIGTERM"
```

## Real-Child Process-Tree Shape

The real-child test installs a fake `agy` binary. cli-tube launches that fake binary with `detached: true`, making the CLI parent its own process-group leader. The parent-alive case records its parent PID, then starts a survivor process with `detached: true` and `stdio: ['ignore', 'inherit', 'inherit']`. The parent-exits case starts a detached launcher, exits the CLI parent immediately, and the launcher creates the actual inherited-stdio survivor 50ms later. The test records parent, launcher, and survivor PIDs and asserts all of them are dead before finalization.

Process-group signaling alone cannot kill these survivors because they move into separate process groups. The first real-child test keeps the parent alive long enough for process-tree collection to discover the descendant with `ps -axo pid=,ppid=`. The Noether regression makes the parent exit before the actual survivor exists, so the fix must use inherited-stdio holder discovery. On Linux, the helper now remembers both the child process's own `/proc/<child>/fd/1,2` targets and the parent stream `/proc/<self>/fd` targets while those handles are still identifiable, then scans `/proc/<pid>/fd` later even if the CLI parent has exited. On macOS, it resolves `lsof` through known absolute paths (`/usr/sbin/lsof`, `/sbin/lsof`, `/usr/bin/lsof`, `/bin/lsof`) independent of the sanitized child PATH. The helper also expands the process tree for any discovered stdio holder before signaling it and signals known holder process groups before finalization. The survivor ignores `SIGTERM`, so the tests only go green if the shared lifecycle helper escalates and kills the actual descendant before finalization.

## GREEN

Command:

```sh
npm test -- --runInBand tests/unit/spawner-cli-tube-backend.test.js -t "timeout discovers inherited stdio holders through known lsof paths when PATH omits lsof"
```

Exit: `0`

```text
PASS unit tests/unit/spawner-cli-tube-backend.test.js
  spawnViaCliTube — failure paths
    ✓ timeout discovers inherited stdio holders through known lsof paths when PATH omits lsof (7 ms)
Test Suites: 1 passed, 1 total
Tests:       94 skipped, 1 passed, 95 total
```

Command:

```sh
npm test -- --runInBand tests/unit/spawner-cli-tube-backend.test.js -t "unknown CLI tool|timeout discovers inherited stdio holders"
```

Exit: `0`

```text
PASS unit tests/unit/spawner-cli-tube-backend.test.js
  spawnViaCliTube — failure paths
    ✓ unknown CLI tool fails gracefully before child execution (3 ms)
    ✓ timeout discovers inherited stdio holders through known lsof paths when PATH omits lsof (6 ms)

Test Suites: 1 passed, 1 total
Tests:       94 skipped, 2 passed, 96 total
```

Command:

```sh
PATH=/usr/bin:/bin:$PATH npm test -- --runInBand tests/unit/spawner-cli-tube-lifecycle-real-child.test.js
```

Exit: `0`

```text
PASS unit tests/unit/spawner-cli-tube-lifecycle-real-child.test.js (12.506 s)
  cli-tube real timeout lifecycle
    ✓ does not finalize a timed-out run until the CLI parent and inherited-stdio descendant are dead (6234 ms)
    ✓ kills an inherited-stdio descendant even when the CLI parent exits before timeout (6229 ms)

Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
```

Environment repair before the broader focused run:

```sh
npm rebuild better-sqlite3
```

```text
rebuilt dependencies successfully
```

Command:

```sh
npm test -- --runInBand tests/unit/spawner-cli-tube-backend.test.js tests/unit/spawner-cli-tube-lifecycle-real-child.test.js tests/unit/spawner-cli-tube-observability.test.js tests/unit/cli-tube-backends-launch.test.js tests/unit/spawner-cli-agy-transcript.test.js tests/unit/spawner-transcripts.test.js tests/unit/spawner-live-transcripts.test.js tests/unit/spawner-budget-cap.test.js tests/unit/spawn-routes-preflight.test.js tests/unit/spawn-status-contract.test.js
```

Exit: `0`

```text
Test Suites: 1 skipped, 9 passed, 9 of 10 total
Tests:       4 skipped, 159 passed, 163 total
Snapshots:   0 total
Time:        19.875 s
```

Command:

```sh
npm run typecheck
```

Exit: `0`

```text
> port-daddy@3.24.2 typecheck
> tsc --noEmit
```

Command:

```sh
git diff --check
```

Exit: `0` (no output)

Exit: `0`

Output: empty.

## Bun Provider Smoke RED/GREEN

CI RED on head `45d6f3fb2805ded2beb9829fbe87667426e6188d`, job `86221482924`:

```text
tests/bun/spawn-provider-binary-daemon.test.ts
error: Test "invokes daemon-resolved Claude and Codex provider binaries and persists transcript output" timed out after 5000ms
error: Test "failed Claude and Codex provider binary launches are not wrapped as successful daemon responses" timed out after 5000ms
Logs reached backend=cli:claude-code, Coast Guard warning, and bond pricing before hanging.
```

Why this was expected RED:

- The provider binary route exercises the real daemon `/spawn` path through `createSpawner()`, `spawnViaCliTube()`, and transcript persistence.
- The hang showed normal fast provider exits could still wait on inherited-stdio/lsof lifecycle work before honest close finalization on Linux/Bun.

GREEN after the lifecycle fix:

```sh
bun test tests/bun/spawn-provider-binary-daemon.test.ts
```

```text
2 pass
0 fail
58 expect() calls
Ran 2 tests across 1 file. [1204.00ms]
```

```sh
bun test tests/bun/
```

```text
82 pass
1 skip
0 fail
315 expect() calls
Ran 83 tests across 16 files. [3.45s]
```

## Why These Tests Are Not Tautologies

- The real-child test uses real OS processes and inherited stdout/stderr. It fails if cli-tube reports completion before both the CLI parent and its inherited-stdio descendant are dead.
- The Noether real-child regression makes the CLI parent exit before timeout, which means parent-process-tree lookup alone cannot find the detached inherited-stdio survivor. It fails unless lifecycle finalization kills the actual holder of the stdout/stderr pipes.
- The Bun provider smoke test goes through the real Fastify `/spawn` route with hermetic provider binaries; it fails if a successful or failed provider child leaves the daemon waiting on stdio/lifecycle finalization.
- The hard-deadline tests keep stdout/stderr pipes open, force the child never to emit `close`, and assert a failed timeout result without stream destruction or leaked `data` listeners.
- The process-tree fallback test forces `ps` to fail, verifies the bounded `maxBuffer` call shape, checks root-pid `SIGTERM`/`SIGKILL` fallback signaling, and requires the final error to disclose the fallback.
- The provider behavior tests run through `spawnViaCliTube`, not just registry shape: provider auth guidance appears in runtime auth failures, placeholder model policy changes actual argv, Codex alone uses `--output-last-message`, non-Codex providers do not receive the output path, binary preflight returns exit 127 without spawning, and agy empty-success failure does not contaminate claude-code/codex/gemini/groq/grok.
- TypeScript derives `CliTubeTool` and `CLI_TUBE_TOOLS` from `CLI_TUBE_PROVIDER_SPECS`; a missing provider spec or unhandled arg style fails at typecheck instead of relying on duplicated provider strings.
