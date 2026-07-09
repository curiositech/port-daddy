# CLI Tube Provider Registry RED/GREEN Evidence

Base for RED: `origin/main` at `65f2ea03e fix(spawner): finalize Cloudflare backend timeouts (#1186)`.

Implementation branch for GREEN: `codex/cli-tube-provider-registry` at local WIP, rebased onto `origin/main` `65f2ea03e`.

Local raw command outputs were captured next to this file while preparing the PR:

- `.scratch/cli-tube-provider-registry-red-output.txt`
- `.scratch/cli-tube-provider-registry-hard-deadline-red-output.txt`
- `.scratch/cli-tube-provider-registry-green-typecheck-output.txt`
- `.scratch/cli-tube-provider-registry-green-focused-output.txt`
- `.scratch/cli-tube-provider-registry-green-transcripts-output.txt`
- `.scratch/cli-tube-provider-registry-green-diffcheck-output.txt`

Only this concise evidence markdown is intended for commit; the raw output files are local scratch artifacts.

## RED

Setup used for RED:

```sh
RED_WORKTREE=$(mktemp -d /tmp/pd-cli-tube-red.XXXXXX)
git worktree add --detach "$RED_WORKTREE" origin/main
cp tests/unit/spawner-cli-tube-backend.test.js "$RED_WORKTREE/tests/unit/spawner-cli-tube-backend.test.js"
cp tests/unit/spawner-cli-tube-lifecycle-real-child.test.js "$RED_WORKTREE/tests/unit/spawner-cli-tube-lifecycle-real-child.test.js"
```

Command run inside the RED worktree:

```sh
PATH=/Users/erichowens/.nvm/versions/node/v22.17.1/bin:$PATH \
NODE_PATH=/Users/erichowens/coding/tmp/wt-cli-tube-provider-registry/node_modules \
node --experimental-vm-modules /Users/erichowens/coding/tmp/wt-cli-tube-provider-registry/node_modules/jest/bin/jest.js --runInBand tests/unit/spawner-cli-tube-backend.test.js tests/unit/spawner-cli-tube-lifecycle-real-child.test.js
```

Exit: `1`

Expected RED output excerpts:

```text
FAIL unit tests/unit/spawner-cli-tube-lifecycle-real-child.test.js (6.289 s)
  cli-tube real timeout lifecycle › does not finalize a timed-out run while an inherited-stdio descendant is still alive

    Expected: false
    Received: true

      65 |     expect(existsSync(pidFile)).toBe(true);
      66 |     const survivorPid = Number(readFileSync(pidFile, 'utf8'));
    > 67 |     expect(await isPidAlive(survivorPid)).toBe(false);
```

```text
FAIL unit tests/unit/spawner-cli-tube-backend.test.js
  CLI tube provider registry contract › every declared CLI tool has one spec with an argv builder and operator guidance

    Expected: true
    Received: false

    > 242 |     expect(Array.isArray(CLI_TUBE_TOOLS)).toBe(true);
```

```text
  CLI tube provider registry contract › provider specs own model placeholder behavior instead of a shared string fallback list

    TypeError: Cannot read properties of undefined (reading 'claude-code')

    > 267 |     expect(CLI_TUBE_PROVIDER_SPECS['claude-code'].modelPolicy).toMatchObject({
```

```text
  CLI tube provider registry contract › agy is the only provider whose empty successful stdout is classified as failure

    TypeError: Cannot read properties of undefined (reading 'agy')

    > 281 |     expect(CLI_TUBE_PROVIDER_SPECS.agy.emptySuccess).toBe('fail');
```

```text
  spawnViaCliTube — failure paths › timeout hard-deadline resolves failed if SIGKILL never produces close, without destroying streams

    expect(jest.fn()).not.toHaveBeenCalled()

    Expected number of calls: 0
    Received number of calls: 1

    > 750 |       expect(stdoutDestroy).not.toHaveBeenCalled();
```

RED summary:

```text
Test Suites: 2 failed, 2 total
Tests:       5 failed, 70 passed, 75 total
```

Why this is the expected RED:

- `origin/main` does not export a typed provider registry, so registry tests fail before implementation.
- `origin/main` cannot express provider-owned model placeholder policy, so the stricter registry contract fails before implementation.
- `origin/main` still force-settles timed-out cli-tube children by destroying streams; the hard-deadline test observes that destruction before a safe failed result.
- The real-child test proves the old timeout finalizes while an inherited-stdio descendant is still alive.

## Hard-Deadline RED

After the first lifecycle cleanup removed the unsafe forced settle, manager review caught the opposite risk: a child that never emits `close` after `SIGKILL` would leave the daemon hung forever. I added the hard-deadline test first and ran it against the then-current local implementation before adding the production deadline.

Command:

```sh
PATH=/Users/erichowens/.nvm/versions/node/v22.17.1/bin:$PATH npm test -- --runInBand tests/unit/spawner-cli-tube-backend.test.js -t "timeout hard-deadline resolves failed"
```

Exit: `1`

Expected output excerpt:

```text
FAIL unit tests/unit/spawner-cli-tube-backend.test.js
  spawnViaCliTube — failure paths › timeout hard-deadline resolves failed if SIGKILL never produces close, without destroying streams

    Expected: true
    Received: false

    > 749 |       expect(settled).toBe(true);

Test Suites: 1 failed, 1 total
Tests:       1 failed, 73 skipped, 74 total
```

## Real-Child Process-Tree Shape

The real-child test installs a fake `agy` binary. cli-tube launches that fake binary with `detached: true`, making the CLI parent its own process-group leader. The fake CLI then starts a survivor process with `detached: true` and `stdio: ['ignore', 'inherit', 'inherit']`. That survivor has its own process group, but it inherits cli-tube's stdout/stderr pipes, so Node should not honestly emit `close` until the survivor exits or those pipes close.

Process-group signaling alone cannot kill this survivor because it moved into a separate process group. The implementation must discover the descendant by walking the process tree with `ps -axo pid=,ppid=` while the parent is still alive, then send signals to the known descendant PIDs as well as the parent group. The survivor ignores `SIGTERM`, so the test only goes green if the shared lifecycle helper escalates and kills the discovered descendant before finalization.

## GREEN

Command:

```sh
PATH=/Users/erichowens/.nvm/versions/node/v22.17.1/bin:$PATH npm run typecheck -- --noEmit
```

Exit: `0`

Output:

```text
> port-daddy@3.24.2 typecheck
> tsc --noEmit --noEmit
```

Command:

```sh
PATH=/Users/erichowens/.nvm/versions/node/v22.17.1/bin:$PATH npm test -- --runInBand tests/unit/spawner-cli-tube-backend.test.js tests/unit/spawner-cli-tube-lifecycle-real-child.test.js tests/unit/spawner-cli-agy-transcript.test.js tests/unit/spawner-cli-tube-observability.test.js tests/unit/cli-tube-backends-launch.test.js
```

Exit: `0`

Output summary from `.scratch/cli-tube-provider-registry-green-focused-output.txt`:

```text
PASS unit tests/unit/spawner-cli-tube-lifecycle-real-child.test.js (5.507 s)
PASS unit tests/unit/spawner-cli-tube-observability.test.js
PASS unit tests/unit/spawner-cli-agy-transcript.test.js (5.287 s)
PASS unit tests/unit/spawner-cli-tube-backend.test.js
PASS unit tests/unit/cli-tube-backends-launch.test.js

Test Suites: 5 passed, 5 total
Tests:       95 passed, 95 total
Snapshots:   0 total
Time:        11.616 s
```

Command:

```sh
PATH=/Users/erichowens/.nvm/versions/node/v22.17.1/bin:$PATH npm test -- --runInBand tests/unit/spawner-transcripts.test.js
```

Exit: `0`

Output summary from `.scratch/cli-tube-provider-registry-green-transcripts-output.txt`:

```text
PASS unit tests/unit/spawner-transcripts.test.js
Test Suites: 1 passed, 1 total
Tests:       13 passed, 13 total
Snapshots:   0 total
Time:        0.239 s, estimated 1 s
```

Command:

```sh
git diff --check
```

Exit: `0`

Output: empty.

## Why These Tests Are Not Tautologies

- The real-child test uses a real child process and a live descendant with inherited stdout/stderr, so it fails if the implementation marks the spawn done before the OS process tree is gone.
- The mocked stream tests catch both lifecycle edges independently of process timing: no stream destruction before honest close, and a bounded failed timeout if `SIGKILL` still never produces `close`.
- The provider registry contract imports the public cli-tube exports and checks runtime shape against `buildArgs`, while TypeScript's mapped registry type catches missing specs at typecheck.
- The agy no-output test runs claude-code, codex, and gemini through `spawnViaCliTube`; it fails if agy's empty-output failure policy leaks to other providers.
