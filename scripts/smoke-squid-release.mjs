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

try {
  if (!existsSync(pd)) fail(`compiled pd not found: ${pd}`);
  // Single-supervisor (3.28) tarball layout: tentacles live ONLY under bin/
  // (the formula pkgshare-installs the directory and lib/squid/assets.ts
  // resolves execDir/../share/port-daddy/bin). The flat top-level copies were
  // dropped with pd-bosun in the 3.28 cutover.
  for (const asset of [
    'bin/pd-hook-prompt',
    'bin/pd-hook-pre-tool',
    'bin/pd-hook-post-tool',
    'bin/pd-statusline',
    'hooks/sessionstart-pilot.mjs',
  ]) {
    if (!existsSync(join(staged, asset))) fail(`staged asset missing before smoke: ${asset}`);
  }

  mkdirSync(join(project, '.portdaddy'), { recursive: true });
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

  const claudeConfig = join(project, '.claude', 'settings.json');
  const geminiConfig = join(project, '.gemini', 'settings.json');
  const codexConfig = join(home, '.codex', 'config.toml');
  const agyConfig = join(home, '.gemini', 'hooks.json');

  expectFile(claudeConfig, 'pd-hook-pre-tool');
  expectFile(join(project, '.claude', 'settings.json'), 'sessionstart-pilot.mjs');
  expectFile(join(project, '.claude', 'settings.json'), 'pd-statusline');
  expectFile(join(project, '.claude', 'commands', 'squid.md'), 'pd squid');
  expectFile(geminiConfig, 'pd-hook-pre-tool');
  expectFile(codexConfig, 'Port Daddy Giant Squid Harness tentacles');
  expectFile(agyConfig, 'pd-hook-pre-tool');

  // Configuration is a durable interface; release-asset paths are packaging
  // details. A Homebrew upgrade may delete the current Cellar version, so every
  // provider must retain only the user-owned stable shim.
  for (const config of [claudeConfig, geminiConfig, codexConfig, agyConfig]) {
    expectFile(config, join(pdHome, 'bin', 'pd-hook-prompt'));
    expectFile(config, join(pdHome, 'bin', 'pd-hook-pre-tool'));
    expectAbsent(config, '/Cellar/');
    expectAbsent(config, staged);
  }

  // Release invariant: each provider gets one turn briefing and one direct-edit
  // gate. The post-tool binary remains staged for safe migration/debug history,
  // but it must never be registered into an interactive lifecycle again.
  for (const config of [claudeConfig, geminiConfig, agyConfig]) {
    expectCount(config, 'pd-hook-prompt', 1);
    expectCount(config, 'pd-hook-pre-tool', 1);
    expectAbsent(config, 'pd-hook-post-tool');
  }
  expectCount(codexConfig, '[[hooks.UserPromptSubmit]]', 1);
  expectCount(codexConfig, '[[hooks.PreToolUse]]', 1);
  expectCount(codexConfig, '[[hooks.PreToolUse.hooks]]', 1);
  expectAbsent(codexConfig, 'pd-hook-post-tool');
  expectAbsent(codexConfig, '[[hooks.PostToolUse]]');
  expectFile(codexConfig, 'matcher = "apply_patch|Edit|Write|edit|write|str_replace_editor"');
  for (const broadTool of ['Bash', 'exec_command', 'shell_command', 'unified_exec', 'run_shell_command']) {
    expectAbsent(codexConfig, `matcher = "${broadTool}`);
    expectAbsent(codexConfig, `|${broadTool}`);
  }
  for (const name of ['pd-hook-prompt', 'pd-hook-pre-tool', 'pd-hook-post-tool']) {
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

  // Prove the staged user-level gate is scoped to the exact armed root. A
  // sibling Port Daddy project must stay inert even while the heartbeat is
  // fresh and the underlying prompt tentacle has context it could emit.
  const sibling = join(root, 'sibling-project');
  const exactRootMarker = 'exact-root-only-release-smoke';
  mkdirSync(join(sibling, '.portdaddy'), { recursive: true });
  writeFileSync(join(pdHome, 'heartbeat'), '{}\n');
  writeFileSync(
    join(pdHome, 'matrix.env'),
    `PD_ALERT_RELEASE_SMOKE="${exactRootMarker} | ts:${new Date().toISOString()}"\n`,
  );

  const runPromptGate = (cwd) => spawnSync(join(pdHome, 'bin', 'pd-hook-prompt'), [], {
    cwd,
    env,
    input: JSON.stringify({ cwd }),
    encoding: 'utf8',
    timeout: 30_000,
  });
  const armedProbe = runPromptGate(project);
  if (armedProbe.status !== 0 || !armedProbe.stdout.includes(exactRootMarker)) {
    fail(`armed root did not activate the staged prompt gate: ${armedProbe.stderr || armedProbe.stdout}`);
  }
  const siblingProbe = runPromptGate(sibling);
  if (siblingProbe.status !== 0 || siblingProbe.stdout.trim() !== '') {
    fail(`unarmed sibling project crossed the exact-root gate: ${siblingProbe.stderr || siblingProbe.stdout}`);
  }

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

  process.stdout.write(
    `SQUID RELEASE SMOKE PASS: ${snapshot.providers.length} providers, state ${snapshot.state}, debug ${debugBytes} bytes, open no-op ${Math.round(openDurationMs)}ms\n`,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
