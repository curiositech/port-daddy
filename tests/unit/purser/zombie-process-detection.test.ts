We need to write a new test file tests/unit/purser/zombie-process-detection.test.ts that tests isPidAlive correctly identifies zombies on Linux and macOS, including edge cases with comm fields containing spaces/parens and fallback when /proc/ps unavailable.

We must use repository imports. Let's inspect repository structure. We don't have actual repo but we can guess. There's lib/spawner/backends/cli-tube-lifecycle.ts and tests/unit/spawner-cli-tube-lifecycle-real-child.test.js. We need to import isPidAlive from that file? The logic is inside that file. But isPidAlive is not exported. We can import the file and maybe access exported functions or not. But we can replicate logic in test? But spec says verify isPidAlive correctly identifies zombies. The test should import the function from the module. Let's search for isPidAlive in repo. It might be exported. In the diff, isPidAlive is defined inside the test file earlier, not exported. But in actual production code, isPidAlive likely is defined in cli-tube-lifecycle.ts and exported. Let's open that file. We have only diff, but we can assume that function exists. Let's read the code near isPidAlive. It's likely defined earlier in the file. But we don't have full file. We need to import from that module. Let's search. In the diff, the function is defined inside tests/unit/spawner-cli-tube-lifecycle-real-child.test.js. But production code may have its own isPidAlive. Let's search for "isPidAlive" in repo. But we can't open repo. We need to guess. It's probably defined in lib/spawner/backends/cli-tube-lifecycle.ts as a helper. Let's assume it's exported. If not, we can import the module and use a named export. We'll try to import { isPidAlive } from '../../../lib/spawner/backends/cli-tube-lifecycle'; relative to tests/unit/purser. Path: tests/unit/purser/... So relative path up to root: ../../.. Actually tests/unit/purser is 3 directories deep from root? Let's map: root/tests/unit/purser. So relative to that file, lib is at ../../lib. So import path: import { isPidAlive } from '../../../lib/spawner/backends/cli-tube-lifecycle'; Wait: tests/unit/purser is depth 3? Let's compute: root/tests/unit/purser. So relative path from tests/unit/purser to lib/spawner/backends/cli-tube-lifecycle.ts: go up 2 levels to root/tests/unit, then up 1 to root/tests, then up 1 to root? Actually tests/unit/purser has parent tests/unit. Parent of tests/unit is tests. Parent of tests is root. So to get to lib/spawner/backends, we need to go up two directories: tests/unit/purser -> tests/unit -> tests -> root. Wait count: starting at tests/unit/purser, go up one -> tests/unit, up two -> tests, up three -> root. So relative path: '../../../lib/spawner/backends/cli-tube-lifecycle'; That seems correct.

But we need to ensure module exports isPidAlive. Let's inspect the file path. The file is lib/spawner/backends/cli-tube-lifecycle.ts. The function is probably exported. If not, we can import the entire module and maybe access via default export? But we can use dynamic import and find function? Might be exported as function isPidAlive. We'll assume.

Now test: we need to test that isPidAlive returns false for zombie processes on Linux and macOS, including edge cases with comm fields containing spaces/parens and fallback when /proc/ps is unavailable.

We need to spawn a child that exits quickly, become zombie. We need to capture zombie state. On Linux, zombie occurs when child exits but parent hasn't reaped it. So we need to spawn a child that exits, but we intentionally not wait on it, so it becomes zombie until parent reaps. But Node's child_process.spawn will automatically wait? Actually if we spawn a child and don't call child.on('exit')? Node's child process will reaping? Node's child process events may cause reaping? In Node, when child process exits, Node automatically reaps it and emits 'exit' event. So there is no zombie. To create zombie, we need to spawn a child that exits, but parent doesn't wait. In Node, child processes are automatically reaped by Node's internal event loop. But we can spawn a child that exits and then use process.waitpid? Node doesn't expose waitpid. But we can spawn a child that does exec, and then we can use process.kill? Wait. Actually to leave zombie, we need to spawn a child that exits and we don't wait for it. Node's child_process module uses libuv to spawn and wait for exit. It attaches a 'close' event that triggers after exit and the reaping. So zombie won't happen.

Alternative: Use low-level fork? Not available. But we can spawn a command that spawns a child and exits, like 'sh -c "sleep 0.1 & wait"'? That will exit after waiting for the child; not zombie. We need a process that exits but leaves zombie: we can spawn a child that forks a grandchild and exits, leaving zombie because parent (our child) didn't reap grandchild. But Node's child process reaps the child itself. But we could spawn a small C program that does fork and exit leaving zombie for its parent, but we don't have such program. But we can use 'sh -c "sleep 0.1 & wait $!"'? That waits. Not good.

We can spawn a child that uses 'sh -c "sleep 0.1 & exit 0"', but the shell will exit after launching background job; the background job will become orphan (reparented to init) and then get reaped by init. Not zombie.

We can spawn a child that execs a program that forks and exits, leaving zombie for parent. For example: 'node -e "process.nextTick(()=>{const child=require(\'child_process\').spawnSync(\'sleep\', [\'1\']);});" ' but Node will wait? spawnSync blocks until exit, not zombie.

Maybe easier: We can use 'sh -c "sleep 1 & wait $!"' again waits.

We might need to spawn a process that spawns a child and exits immediately, but we don't reap that child. But Node will reap the child process we spawned; but the child process's child will be orphaned, not zombie. So no.

Maybe we can use 'sh -c "trap '' EXIT; sleep 1 & pid=$!; wait $pid; exit 0"'? That still waits.

Alternatively, we can spawn a process that uses 'sh -c "sleep 1 & echo $!; exit 0"' but that prints pid; but parent doesn't wait.

But again the shell will exit, leaving background job orphaned, reparented to init, not zombie.

Thus to create zombie we need to have a parent that exits without reaping child. But we cannot control Node's internal reaping. But we can spawn a child that spawns another child and then calls 'process.exit(0)' without waiting. The shell will exit, leaving the child orphaned; but orphaned means reparent to init and will be reaped by init, not zombie. To get zombie we need parent to exit but not reap: the zombie appears until reaped by parent. So we need a parent that exits but we hold onto its PID? Not possible.

Wait: The zombie appears when parent hasn't reaped child. In this case, if the parent process exits, the child becomes orphan and is reparented to init, which will eventually reap it. So zombie exists only until init reaps. But if parent doesn't exit, zombie remains until parent reaps. So to create zombie, we need to fork a child that exits, but we don't call waitpid. Node's child_process will call waitpid internally. So we cannot create zombie using Node's spawn.

Alternate approach: We can spawn a child that spawns a grandchild and exits, and we keep the grandchild running; but the grandchild will be orphaned to init, not zombie. So not.

Maybe we can spawn a child that forks a grandchild and exits, but we keep the child process alive by not waiting? Node will wait for child exit. So not.

Thus we cannot create zombie via Node's spawn. But we can check zombie detection by creating a process that exits quickly, then we call isPidAlive on its PID after it has exited but before Node reaps? Node reaps quickly. But we can spawn a child that exits immediately and then we call isPidAlive on its PID after Node has reaped? Then the PID will be gone; isPidAlive should return false. But that doesn't test zombie detection.

Maybe we can test isPidAlive logic by mocking /proc/PID/stat to simulate zombie state. We can create a temporary file /proc/PID/stat? Not possible.

Alternatively, we can use 'ps' to find a zombie process on the system. But tests should be deterministic and not rely on external processes. But we can spawn a child that spawns a grandchild and exits, but we can then kill the parent (our Node process) to leave zombie? Not.

We could spawn a child that calls 'exec("sh -c \'sleep 0.1 & exit 0\'")' and then we kill that child before it exits? That will leave zombie? If we kill the child process but not wait, the child process will exit with signal, but the zombie may appear? But Node will reap.

Maybe we can use 'node -e "setTimeout(()=>{}, 1)"' but Node will exit after timer? Not.

Better plan: Use 'sh -c "sleep 1 & pid=$!; kill -s SIGSTOP $pid; exit 0"'? The shell exits, leaving background job orphaned. Not zombie.

Ok.

Maybe we can test isPidAlive by using the actual logic: it uses process.kill(pid,0) and then reads /proc/PID/stat. We can create a dummy PID by launching a child that sleeps for a while, then we kill it and then we test isPidAlive on that PID. It will be gone, so isPidAlive should return false. But that's trivial.

The requirement: "Verify isPidAlive correctly identifies zombies on Linux and macOS, including edge cases with comm fields containing spaces/parens and fallback behavior when /proc/ps is unavailable." So we need to simulate zombie state. We can create a child that exits but we don't reap it? Might be possible to spawn a child that spawns a grandchild and then exit, then we can use 'ps' to find the grandchild? But the grandchild will be orphaned to init, not zombie. But the grandchild will be reaped by init after some time. But we can check its state with ps at that moment and see if it's zombie? But orphaned processes are not zombies; they are reparented to init and then init will reap them. So they are not zombies.

We need a zombie: parent alive but hasn't reaped child. So we need to spawn a child that spawns a grandchild and then exit, but we need to keep the parent alive. But we can't because Node reaps child. But we can spawn a child that spawns a grandchild and then is parent of grandchild, but we don't want Node to reap that child. But Node will reap it. So not.

Maybe we can spawn a shell that forks a child and then exits. The shell will exit; the child becomes orphan; not zombie. So can't.

Thus maybe we can't create zombie reliably. But we can test isPidAlive logic by mocking process.kill to throw for zombie? But we want to test actual logic.

Alternative: Use ChildProcess.spawn with 'sh -c "sleep 1 & exit 0"'? The shell will exit, leaving background job orphaned. But we can then inspect with ps to see if the background job is zombie? It will be orphaned, not zombie. But we can confirm ps shows 'Z' state? Typically orphaned processes are in 'S' state? Let's check: When a process is orphaned, init reaps it when it exits. It might become zombie until init reaps. But if we kill the parent (shell) quickly, the child becomes orphan and may become zombie until init reaps. But we can check after a short delay. So we can spawn a shell that spawns a child and exits. After a short delay, the child may be in zombie state until init reaps. That might happen. So we can test isPidAlive on that child PID after we kill its parent. We need to ensure the child hasn't been reaped yet. We'll need to wait a short time. This may be flaky but we can attempt.

Let's design test:

- Spawn a child process: 'sh -c "sleep 5 & exit 0"'. This shell will exit immediately, leaving background job 'sleep 5'. The background job becomes orphan, will be reparented to init. For a short time, it might be in zombie state until init reaps. On Linux, init (PID 1) reaps it quickly. But may be immediate? We can wait 10ms and check. But maybe it's not zombie yet.

- We can spawn a child that spawns a child and exits, but we can kill the parent process after spawn? But we can't kill parent because it's part of our test harness.

Alternate: Use 'sh -c "sleep 0.1 & kill $!; exit 0"'? That kills the child, not zombie.

Maybe we can spawn a child that forks and then kills itself? Not.

Hmm.

Maybe we can rely on 'ps' output to identify zombie state. We can spawn a child process that is zombie by launching a process that forks and exits but we don't wait. But we can't control Node's reaping.

But we can use 'sh -c "sleep 5 & pid=$!; echo $pid; exit 0"' then we capture the pid of background sleep. The shell exits, leaving sleep orphaned. But we can check its state after a short wait. It may be 'S' or 'D', not zombie. Let's check typical behavior: When a process is orphaned, the parent becomes init; init reaps it when it exits. The child may be in 'S' state until reaped. But not necessarily zombie.

Thus maybe we can't reliably create zombie.

Alternative: We can mock /proc/PID/stat to contain 'Z' state for a given PID. But isPidAlive reads /proc/PID/stat directly from filesystem. We could create a fake /proc directory? Not possible.

But we can test the parsing logic by calling isPidAlive on a fake PID that we create and then we can create a fake /proc/PID/stat file in a temporary directory and monkeypatch process.platform? Not.

We can monkeypatch readFileSync to return a string with the stat format. But isPidAlive uses readFileSync from 'node:fs' imported at top. We can import the function and then patch the module? We can use jest.spyOn(fs, 'readFileSync') to return custom data for a given path. That will simulate reading /proc/PID/stat. We can also mock execFileSync to simulate ps output.

Thus we can test the behavior of isPidAlive without needing actual zombie processes.

Specifically, we can:

- Mock process.platform to 'linux', then test isPidAlive for a PID where readFileSync returns a stat string with state 'Z' (zombie). We expect false.

- For a PID where state is 'R' (running), expect true.

- For a PID where state is 'S' (sleeping), expect true.

- For a PID where state is 'Z' but we also want to test comm containing spaces and parentheses. For example: "1234 (my process (with parens)) S ...". The parsing logic uses lastIndexOf(')').

- For a PID where /proc/PID/stat is missing or throws, we test fallback: execFileSync returns 'R' state; expect true. For missing execFileSync, we test fallback to true.

- For macOS: we can mock process.platform to 'darwin' and execFileSync to return 'Z', expect false.

- For missing execFileSync: fallback true.

Thus we can test logic.

We need to import isPidAlive from cli-tube-lifecycle. If not exported, we can import entire module and access property? Let's check if isPidAlive is exported. The diff didn't show exports. But maybe it's exported. If not, we can import the module and then use the exported function if exists. But we can also import the module and look for exported isPidAlive. But we can't rely on that.

Alternatively, we can import the file and use dynamic import to get the function. But we can also import the file as module and then use the function. Let's try:

import { isPidAlive } from '../../../lib/spawner/backends/cli-tube-lifecycle';

If fails, we can adjust.

Now test skeleton:

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';

import { isPidAlive } from '../../../lib/spawner/backends/cli-tube-lifecycle';

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'; // maybe not needed.

import { execFileSync } from 'node:child_process';

import { jest } from '@jest/globals';

We'll need to mock readFileSync and execFileSync.

We also need to temporarily change process.platform? process.platform is read-only. We cannot set it. But we can monkeypatch process.platform property? In Node, process.platform is a read-only property. We can use Object.defineProperty(process, 'platform', { value: 'darwin' }); to override. But this might affect other tests. We'll use jest.spyOn(process, 'platform', 'get')? Not sure. We can use jest.spyOn(process, 'platform', 'get').mockReturnValue('darwin'); But process.platform is a getter property. According to Node docs, it's read-only but can be overridden by using Object.defineProperty. We can do that.

We need to ensure we restore original value after tests.

Thus we can create a helper function to temporarily override process.platform.

Also we need to mock execFileSync and readFileSync. Use jest.spyOn(fs, 'readFileSync').mockImplementation(...). And jest.spyOn(child_process, 'execFileSync').

We need to import fs and child_process modules.

We also need to test that isPidAlive uses readFileSync if process.platform === 'linux', else uses execFileSync.

But isPidAlive uses process.kill first. In our tests, we don't want to kill real processes. process.kill may throw if pid not exist. So we need to mock process.kill to do nothing for our test PIDs. We'll use jest.spyOn(process, 'kill').mockImplementation(() => {});

But process.kill is a function; we can spy on it. We'll restore after each test.

Ok.

Test cases:

1. Linux, readFileSync returns stat string with state 'Z' (zombie). Expect false.

2. Linux, readFileSync returns stat string with state 'R'. Expect true.

3. Linux, readFileSync