#!/usr/bin/env node
/**
 * Prove a staged release can arm the Giant Squid from outside the source tree.
 *
 * This is deliberately an artifact test, not a source test: it launches the
 * compiled `pd`, supplies only the staged release directory, and asserts every
 * provider's real interactive config scope plus the identity/steering assets.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, join, resolve } from 'node:path';

const pd = resolve(process.argv[2] ?? 'dist/pd');
const staged = resolve(process.argv[3] ?? 'dist');
const scratchParent = resolve(process.cwd(), '.scratch');
mkdirSync(scratchParent, { recursive: true });
const root = mkdtempSync(join(scratchParent, 'squid-release-smoke-'));
const home = join(root, 'home');
const project = join(root, 'project');
const fakeBin = join(root, 'fake-bin');
const pdHome = join(root, 'pd-home');

function fail(message) {
  throw new Error(`[squid-release-smoke] ${message}`);
}

function expectFile(path, needle) {
  if (!existsSync(path)) fail(`expected file was not written: ${path}`);
  if (needle && !readFileSync(path, 'utf8').includes(needle)) {
    fail(`expected ${path} to contain ${JSON.stringify(needle)}`);
  }
}

function expectAbsent(path, needle) {
  if (!existsSync(path)) fail(`expected file was not written: ${path}`);
  if (readFileSync(path, 'utf8').includes(needle)) {
    fail(`expected ${path} not to contain ${JSON.stringify(needle)}`);
  }
}

function expectCount(path, needle, count) {
  if (!existsSync(path)) fail(`expected file was not written: ${path}`);
  const actual = readFileSync(path, 'utf8').split(needle).length - 1;
  if (actual !== count) {
    fail(`expected ${path} to contain ${JSON.stringify(needle)} ${count} time(s), got ${actual}`);
  }
}

function git(cwd, ...args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  if (result.status !== 0) fail(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

try {
  if (!existsSync(pd)) fail(`compiled pd not found: ${pd}`);
  // Single-supervisor (3.28) tarball layout: tentacles live ONLY under bin/
  // (the formula pkgshare-installs the directory and lib/squid/assets.ts
  // resolves execDir/../share/port-daddy/bin). The flat top-level copies were
  // dropped with pd-bosun in the 3.28 cutover.
  for (const asset of [
    'bin/pd-hook-prompt',
    'bin/pd-hook-precompact',
    'bin/pd-hook-pre-tool',
    'bin/pd-hook-post-tool',
    'bin/pd-hook-stop',
    'bin/pd-statusline',
    'hooks/sessionstart-pilot.mjs',
  ]) {
    if (!existsSync(join(staged, asset))) fail(`staged asset missing before smoke: ${asset}`);
  }

  mkdirSync(join(project, '.portdaddy'), { recursive: true });
  writeFileSync(join(project, '.portdaddy', 'project.json'), '{}\n');
  writeFileSync(join(project, 'README.md'), 'release smoke\n');
  git(project, 'init', '--initial-branch=main');
  git(project, 'config', 'user.email', 'squid-release@example.invalid');
  git(project, 'config', 'user.name', 'Squid Release Smoke');
  git(project, 'add', '.portdaddy/project.json', 'README.md');
  git(project, 'commit', '-m', 'release smoke fixture');
  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(home, { recursive: true });
  for (const name of ['claude', 'codex', 'gemini', 'agy']) {
    const path = join(fakeBin, name);
    writeFileSync(path, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }

  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    PD_HOME: pdHome,
    PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
    NO_COLOR: '1',
    TERM: 'dumb',
  };
  const arm = spawnSync(pd, ['squid', 'on', '--cwd', project], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (arm.status !== 0) {
    fail(`pd squid on exited ${arm.status}\nstdout:\n${arm.stdout}\nstderr:\n${arm.stderr}`);
  }
  if (!arm.stdout.includes('Giant Squid harness ARMED')) fail('arm output did not claim the fully armed state');
  if (!arm.stdout.includes('PORT DADDY IS ADDING VALUE OUTSIDE THE CONVERSATION')) fail('arm output omitted the non-diegetic value card');

  const claudeProjectConfig = join(project, '.claude', 'settings.json');
  const claudeConfig = join(home, '.claude', 'settings.json');
  const geminiConfig = join(home, '.gemini', 'settings.json');
  const codexConfig = join(home, '.codex', 'config.toml');
  const agyConfig = join(home, '.gemini', 'hooks.json');

  expectFile(claudeConfig, 'pd-hook-pre-tool');
  expectFile(claudeConfig, 'pd-hook-precompact');
  expectFile(claudeProjectConfig, 'sessionstart-pilot.mjs');
  expectFile(claudeProjectConfig, 'pd-statusline');
  expectFile(join(project, '.claude', 'commands', 'squid.md'), 'pd squid');
  expectFile(geminiConfig, 'pd-hook-pre-tool');
  expectFile(codexConfig, 'Port Daddy Giant Squid Harness tentacles');
  expectFile(agyConfig, 'pd-hook-pre-tool');
  expectAbsent(claudeProjectConfig, 'PD_HOOK_PROVIDER=claude');

  // Configuration is a durable interface; release-asset paths are packaging
  // details. A Homebrew upgrade may delete the current Cellar version, so every
  // provider must retain only the user-owned stable shim.
  for (const config of [claudeConfig, geminiConfig, codexConfig, agyConfig]) {
    expectFile(config, join(pdHome, 'bin', 'pd-hook-prompt'));
    expectFile(config, join(pdHome, 'bin', 'pd-hook-pre-tool'));
    expectFile(config, join(pdHome, 'bin', 'pd-hook-stop'));
    expectAbsent(config, '/Cellar/');
    expectAbsent(config, staged);
  }
  // The checkpoint is a verified Claude capability, not an inferred provider
  // parity promise. Its release shim is therefore required in only that config.
  expectFile(claudeConfig, join(pdHome, 'bin', 'pd-hook-precompact'));
  for (const config of [geminiConfig, codexConfig, agyConfig]) {
    expectAbsent(config, 'pd-hook-precompact');
  }

  // Release invariant: each provider gets one turn briefing, one direct-edit
  // gate, and one end-of-turn closeout gate. The post-tool binary remains
  // staged for safe migration/debug history, but it must never be registered
  // into an interactive lifecycle again.
  for (const config of [claudeConfig, geminiConfig, agyConfig]) {
    expectCount(config, 'pd-hook-prompt', 1);
    expectCount(config, 'pd-hook-pre-tool', 1);
    expectCount(config, 'pd-hook-stop', 1);
    expectAbsent(config, 'pd-hook-post-tool');
  }
  expectCount(claudeConfig, 'pd-hook-precompact', 1);
  expectCount(codexConfig, '[[hooks.UserPromptSubmit]]', 1);
  expectCount(codexConfig, '[[hooks.PreToolUse]]', 1);
  expectCount(codexConfig, '[[hooks.PreToolUse.hooks]]', 1);
  expectCount(codexConfig, '[[hooks.Stop]]', 1);
  expectCount(codexConfig, '[[hooks.Stop.hooks]]', 1);
  expectAbsent(codexConfig, 'pd-hook-post-tool');
  expectAbsent(codexConfig, '[[hooks.PostToolUse]]');
  expectFile(codexConfig, 'matcher = "apply_patch|Edit|Write|edit|write|str_replace_editor"');
  for (const broadTool of ['Bash', 'exec_command', 'shell_command', 'unified_exec', 'run_shell_command']) {
    expectAbsent(codexConfig, `matcher = "${broadTool}`);
    expectAbsent(codexConfig, `|${broadTool}`);
  }
  for (const name of ['pd-hook-prompt', 'pd-hook-precompact', 'pd-hook-pre-tool', 'pd-hook-post-tool', 'pd-hook-stop']) {
    expectFile(join(pdHome, 'bin', name), '.portdaddy');
    expectFile(join(pdHome, 'bin', 'squid', name));
  }
  expectFile(join(pdHome, 'hooks', 'sessionstart-pilot.mjs'), 'Port Daddy Pilot');

  const status = spawnSync(pd, ['squid', 'status', '--json', '--cwd', project], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (status.status !== 0) fail(`status probe exited ${status.status}: ${status.stderr}`);
  const snapshot = JSON.parse(status.stdout);
  if (snapshot.state !== 'READY') fail(`expected daemon-down artifact state READY, got ${snapshot.state}`);
  for (const slug of ['claude', 'codex', 'gemini', 'agy']) {
    const provider = snapshot.providers.find((item) => item.slug === slug);
    if (!provider?.detected || !provider?.wired) fail(`${slug} was not detected and wired in its canonical scope`);
  }

  // The compiled launcher has a 64 KiB stdout boundary. Prove a real retained
  // history is projected into a complete, explicitly truncated JSON document
  // instead of exiting zero after slicing the document mid-object.
  const debugDir = join(pdHome, 'squid');
  const debugStartedAt = Date.now() - 10_000;
  mkdirSync(debugDir, { recursive: true });
  writeFileSync(join(debugDir, 'debug.enabled'), `${new Date(debugStartedAt).toISOString()}\n`);
  const workspaceB64 = Buffer.from(project).toString('base64');
  const debugEvents = Array.from({ length: 3_500 }, (_, index) => [
    'v1',
    'start',
    `release-debug-${index}`,
    'codex:release-smoke',
    'codex',
    'edit',
    'pd-hook-pre-tool',
    String(debugStartedAt + index),
    '1000',
    '-',
    '-',
    workspaceB64,
  ].join('\t'));
  writeFileSync(join(debugDir, 'hook-events.log'), `${debugEvents.join('\n')}\n`);
  const debugStatus = spawnSync(pd, ['squid', 'debug', 'status', '--json', '--cwd', project], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (debugStatus.status !== 0) {
    fail(`debug status probe exited ${debugStatus.status}\nstdout:\n${debugStatus.stdout}\nstderr:\n${debugStatus.stderr}`);
  }
  const debugBytes = Buffer.byteLength(debugStatus.stdout);
  if (debugBytes >= 64 * 1024) fail(`debug status emitted ${debugBytes} bytes; compiled ceiling is 65536`);
  let debugSnapshot;
  try {
    debugSnapshot = JSON.parse(debugStatus.stdout);
  } catch (error) {
    fail(`debug status did not emit complete JSON: ${String(error)}`);
  }
  if (debugSnapshot.window?.totalSteps !== 3_500 || !debugSnapshot.window?.truncated) {
    fail('compiled debug status did not advertise its bounded history window');
  }
  if (!(debugSnapshot.window.returnedSteps > 0 && debugSnapshot.window.returnedSteps < 3_500)) {
    fail(`compiled debug status returned an invalid step window: ${JSON.stringify(debugSnapshot.window)}`);
  }
  const newestDebugStep = debugSnapshot.sessions
    .flatMap((session) => session.steps)
    .find((step) => step.id === 'release-debug-3499');
  if (!newestDebugStep?.startedAt || !newestDebugStep?.expectedBy) {
    fail('compiled debug status dropped the newest actual/expected timestamps');
  }

  // Prove the staged user-level gate is scoped to the local repository family.
  // A linked worktree created after arm inherits without config mutation, while
  // an unrelated same-remote clone remains inert even while one exact daemon
  // generation is ready and the underlying prompt tentacle has context it
  // could emit. This fixture is the release artifact's complete filesystem
  // lease contract: PID + matching readiness marker + fresh heartbeat.
  const future = join(root, 'future-worktree');
  const sibling = join(root, 'same-remote-unrelated-clone');
  const familyMarker = 'repository-family-release-smoke';
  const configBytesBeforeFuture = new Map(
    [claudeConfig, geminiConfig, codexConfig, agyConfig].map((path) => [path, readFileSync(path, 'utf8')]),
  );
  git(project, 'worktree', 'add', '-b', 'future-release-smoke', future);
  git(root, 'clone', project, sibling);
  for (const [path, bytes] of configBytesBeforeFuture) {
    if (readFileSync(path, 'utf8') !== bytes) fail(`future worktree mutated shared provider config: ${path}`);
  }
  writeFileSync(join(pdHome, 'daemon.pid'), `${process.pid}\n`);
  writeFileSync(join(pdHome, 'daemon.ready'), `${process.pid}\n`);
  writeFileSync(join(pdHome, 'heartbeat'), '{}\n');
  writeFileSync(
    join(pdHome, 'matrix.env'),
    `PD_ALERT_RELEASE_SMOKE="${familyMarker} | ts:${new Date().toISOString()}"\n`,
  );

  const runPromptGate = (cwd) => spawnSync(join(pdHome, 'bin', 'pd-hook-prompt'), [], {
    cwd,
    env,
    input: JSON.stringify({ cwd }),
    encoding: 'utf8',
    timeout: 30_000,
  });
  const armedProbe = runPromptGate(project);
  if (armedProbe.status !== 0 || !armedProbe.stdout.includes(familyMarker)) {
    fail(`armed root did not activate the staged prompt gate: ${armedProbe.stderr || armedProbe.stdout}`);
  }
  const findPromptCommand = (value) => {
    if (typeof value === 'string') return value.includes('pd-hook-prompt') ? value : null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findPromptCommand(item);
        if (found) return found;
      }
    } else if (value && typeof value === 'object') {
      for (const item of Object.values(value)) {
        const found = findPromptCommand(item);
        if (found) return found;
      }
    }
    return null;
  };
  for (const [provider, configPath] of [
    ['claude', claudeConfig],
    ['codex', codexConfig],
    ['gemini', geminiConfig],
    ['agy', agyConfig],
  ]) {
    const raw = readFileSync(configPath, 'utf8');
    const command = provider === 'codex'
      ? raw.match(/command = "([^"]*pd-hook-prompt[^"]*)"/)?.[1]
      : findPromptCommand(JSON.parse(raw));
    if (!command?.includes(`PD_HOOK_PROVIDER=${provider}`)) fail(`${provider} did not install its exact user prompt command`);
    const inherited = spawnSync('/bin/sh', ['-c', command], {
      cwd: future,
      env,
      input: JSON.stringify({ cwd: future }),
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (inherited.status !== 0 || !inherited.stdout.includes(familyMarker)) {
      fail(`${provider} user hook did not activate in a future linked worktree: ${inherited.stderr || inherited.stdout}`);
    }
  }
  const siblingProbe = runPromptGate(sibling);
  if (siblingProbe.status !== 0 || siblingProbe.stdout.trim() !== '') {
    fail(`unrelated same-remote clone crossed the repository-family gate: ${siblingProbe.stderr || siblingProbe.stdout}`);
  }

  const denyFuture = spawnSync(pd, ['squid', 'off', '--this-worktree', '--cwd', future], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (denyFuture.status !== 0) fail(`per-worktree deny failed: ${denyFuture.stderr || denyFuture.stdout}`);
  if (runPromptGate(future).stdout.trim() !== '') fail('per-worktree deny did not make the future worktree inert');
  if (!runPromptGate(project).stdout.includes(familyMarker)) fail('per-worktree deny affected its repository sibling');

  const rearmFuture = spawnSync(pd, ['squid', 'on', '--cwd', future], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (rearmFuture.status !== 0) fail(`re-arm from denied worktree failed: ${rearmFuture.stderr || rearmFuture.stdout}`);
  if (!runPromptGate(future).stdout.includes(familyMarker)) fail('re-arm did not clear the verified worktree deny');

  // Exercise the compiled wrapper's containment contract, not merely its
  // generated text. A missing-runtime-style exit 127 must never leak to the
  // provider, must open after three calls, and must stop executing the child.
  const breakerCount = join(pdHome, 'breaker-count');
  writeFileSync(
    join(pdHome, 'bin', 'squid', 'pd-hook-pre-tool'),
    `#!/bin/sh\nprintf x >> '${breakerCount}'\nexit 127\n`,
    { mode: 0o755 },
  );
  const runEditGate = () => spawnSync(join(pdHome, 'bin', 'pd-hook-pre-tool'), [], {
    cwd: project,
    env,
    input: JSON.stringify({ cwd: project, tool_name: 'Edit', tool_input: { file_path: 'README.md' } }),
    encoding: 'utf8',
    timeout: 30_000,
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const failure = runEditGate();
    if (failure.status !== 0) fail(`breaker leaked child exit ${failure.status} on attempt ${attempt + 1}`);
  }
  const openStarted = performance.now();
  const openProbe = runEditGate();
  const openDurationMs = performance.now() - openStarted;
  if (openProbe.status !== 0) fail(`open circuit exited ${openProbe.status}`);
  if (readFileSync(breakerCount, 'utf8') !== 'xxx') fail('open circuit executed the unhealthy child again');
  if (openDurationMs >= 500) fail(`open circuit no-op took ${Math.round(openDurationMs)} ms`);

  const degradedStatus = spawnSync(pd, ['squid', 'status', '--json', '--cwd', project], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (degradedStatus.status !== 1) fail(`degraded status should exit 1, got ${degradedStatus.status}`);
  const degraded = JSON.parse(degradedStatus.stdout);
  const editCircuit = degraded.health?.circuits?.find((item) => item.hook === 'pd-hook-pre-tool');
  if (degraded.state !== 'DEGRADED' || editCircuit?.lastReason !== 'exit_127') {
    fail('compiled status did not expose the opened edit-hook circuit');
  }
  const firstNotice = runPromptGate(project);
  const secondNotice = runPromptGate(project);
  if (!firstNotice.stdout.includes('PD SAFE MODE') || secondNotice.stdout.includes('PD SAFE MODE')) {
    fail('compiled wrapper did not emit exactly one turn-level remediation notice');
  }

  const familyOff = spawnSync(pd, ['squid', 'off', '--cwd', project], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (familyOff.status !== 0) fail(`repository-family off failed: ${familyOff.stderr || familyOff.stdout}`);
  if (runPromptGate(project).stdout.trim() !== '' || runPromptGate(future).stdout.trim() !== '') {
    fail('repository-family off did not revoke all linked worktrees');
  }
  for (const configPath of [claudeConfig, geminiConfig, codexConfig, agyConfig]) {
    if (!existsSync(configPath)) fail(`family off removed dormant shared provider config: ${configPath}`);
  }

  process.stdout.write(
    `SQUID RELEASE SMOKE PASS: ${snapshot.providers.length} providers, state ${snapshot.state}, debug ${debugBytes} bytes, open no-op ${Math.round(openDurationMs)}ms\n`,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
