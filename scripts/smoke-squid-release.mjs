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

try {
  if (!existsSync(pd)) fail(`compiled pd not found: ${pd}`);
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

  expectFile(join(project, '.claude', 'settings.json'), 'pd-hook-pre-tool');
  expectFile(join(project, '.claude', 'settings.json'), 'sessionstart-pilot.mjs');
  expectFile(join(project, '.claude', 'settings.json'), 'pd-statusline');
  expectFile(join(project, '.claude', 'commands', 'squid.md'), 'pd squid');
  expectFile(join(project, '.gemini', 'settings.json'), 'pd-hook-pre-tool');
  expectFile(join(home, '.codex', 'config.toml'), 'Port Daddy Giant Squid Harness tentacles');
  expectFile(join(home, '.gemini', 'hooks.json'), 'pd-hook-pre-tool');
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

  process.stdout.write(`SQUID RELEASE SMOKE PASS: ${snapshot.providers.length} providers, state ${snapshot.state}\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
