import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  deriveSquidConformance,
  readSquidConformance,
  type SquidConformanceFacts,
  type SquidProviderConformance,
} from '../../lib/squid/conformance.js';
import { CODEX_PD_MARKER, REGISTERED_TENTACLES, TENTACLES } from '../../lib/squid/hook-shape.js';

const SCRATCH = join(homedir(), 'coding', 'tmp', 'squid-conformance-selftest', `jest-${process.pid}`);

function provider(overrides: Partial<SquidProviderConformance> = {}): SquidProviderConformance {
  return {
    name: 'Codex CLI',
    slug: 'codex',
    detected: true,
    expectedScope: 'user',
    configPath: '/home/.codex/config.toml',
    configured: true,
    wired: true,
    missingTentacles: [],
    ...overrides,
  };
}

function fullFacts(overrides: Partial<SquidConformanceFacts> = {}): SquidConformanceFacts {
  return {
    projectRoot: '/repo',
    projectArmed: true,
    daemonAlive: true,
    daemonReady: true,
    tentaclesStaged: true,
    statuslineStaged: true,
    statuslineVisible: true,
    statuslineUser: false,
    slashCommand: true,
    pilotSessionStart: true,
    inboxSessionStart: true,
    providers: [provider()],
    ...overrides,
  };
}

afterEach(() => rmSync(SCRATCH, { recursive: true, force: true }));

describe('Giant Squid conformance', () => {
  test('does not suggest arming an ephemeral system-temp worktree', () => {
    const snapshot = deriveSquidConformance({
      projectRoot: '/private/tmp/abandoned-agent',
      projectArmed: false,
      daemonAlive: true,
      daemonReady: true,
      tentaclesStaged: true,
      statuslineStaged: true,
      statuslineVisible: false,
      statuslineUser: false,
      slashCommand: false,
      pilotSessionStart: false,
      inboxSessionStart: true,
      providers: [],
    });

    expect(snapshot.level).toBe('PARTIAL');
    expect(snapshot.missing[0]).toContain('ephemeral system temp root');
    expect(snapshot.repair).toContain('~/coding/tmp');
    expect(snapshot.repair).not.toContain('pd squid on');
  });

  test('LIVE means exact-root gate, staged tentacles, provider wiring, identity, and daemon are all real', () => {
    const result = deriveSquidConformance(fullFacts());

    expect(result).toMatchObject({
      level: 'LIVE',
      score: 100,
      projectArmed: true,
      daemonAlive: true,
      detectedProviders: 1,
      wiredProviders: 1,
      identityReady: true,
      capabilities: {
        suggestibility: true,
        editProtection: true,
        trace: false,
        inbox: true,
        parleyDelivery: true,
        automatedParley: false,
        skillGrafting: false,
      },
    });
    expect(result.truth.bufferProtection).toContain('does not back up unsaved editor buffers');
    expect(result.truth.parley).toContain('convening is still explicit');
  });

  test('READY is fully wired but inert while the daemon heartbeat is down', () => {
    const result = deriveSquidConformance(fullFacts({ daemonAlive: false }));

    expect(result.level).toBe('READY');
    expect(result.capabilities.suggestibility).toBe(false);
    expect(result.missing).toContain('daemon heartbeat is not fresh');
    expect(result.repair).toBe('port-daddy start');
  });

  test('READY stays honest while the live daemon is still behind its boot gate', () => {
    const result = deriveSquidConformance(fullFacts({ daemonAlive: true, daemonReady: false }));

    expect(result.level).toBe('READY');
    expect(result.daemonAlive).toBe(true);
    expect(result.daemonReady).toBe(false);
    expect(result.capabilities.suggestibility).toBe(false);
    expect(result.capabilities.inbox).toBe(false);
    expect(result.missing).toContain('daemon readiness lease does not match the current PID');
    expect(result.repair).toContain('finish its boot checks');
  });

  test('a legacy caller that omits readiness fails closed instead of inheriting liveness', () => {
    const { daemonReady: _omitted, ...legacyFacts } = fullFacts();
    const result = deriveSquidConformance(legacyFacts as SquidConformanceFacts);

    expect(result.daemonAlive).toBe(true);
    expect(result.daemonReady).toBe(false);
    expect(result.level).toBe('READY');
    expect(result.capabilities.suggestibility).toBe(false);
    expect(result.missing).toContain('daemon readiness lease does not match the current PID');
  });

  test('PARTIAL names incomplete provider wiring and supplies one repair command', () => {
    const result = deriveSquidConformance(fullFacts({
      providers: [provider({ configured: false, wired: false, missingTentacles: ['pd-hook-pre-tool'] })],
    }));

    expect(result.level).toBe('PARTIAL');
    expect(result.wiredProviders).toBe(0);
    expect(result.missing).toContain('Codex CLI user hook wiring is incomplete');
    expect(result.repair).toBe('pd hooks install --cwd "/repo"');
  });

  test('an agent without a worktree is visibly UNPROTECTED', () => {
    const result = deriveSquidConformance(fullFacts({
      projectRoot: null,
      projectArmed: false,
      daemonAlive: false,
      tentaclesStaged: false,
      statuslineStaged: false,
      statuslineVisible: false,
      slashCommand: false,
      pilotSessionStart: false,
      inboxSessionStart: false,
      providers: [],
    }));

    expect(result.level).toBe('UNPROTECTED');
    expect(result.score).toBe(0);
    expect(result.repair).toContain('linked worktree');
  });

  test('filesystem reader verifies all four provider-native configs against one exact project root', () => {
    const workspace = join(SCRATCH, 'workspace');
    const fakeHome = join(SCRATCH, 'home');
    const pdHome = join(SCRATCH, 'pd-home');
    mkdirSync(join(workspace, '.claude', 'commands'), { recursive: true });
    mkdirSync(join(workspace, '.gemini'), { recursive: true });
    mkdirSync(join(fakeHome, '.codex'), { recursive: true });
    mkdirSync(join(fakeHome, '.gemini'), { recursive: true });
    mkdirSync(join(pdHome, 'bin', 'squid'), { recursive: true });
    mkdirSync(join(pdHome, 'squid'), { recursive: true });

    const hookCommands = REGISTERED_TENTACLES.map((name) => ({ hooks: [{ type: 'command', command: `/gate/${name}` }] }));
    writeFileSync(join(workspace, '.claude', 'settings.json'), JSON.stringify({
      statusLine: { command: '/gate/pd-statusline' },
      hooks: {
        UserPromptSubmit: [hookCommands[0]],
        PreToolUse: [hookCommands[1]],
        Stop: [hookCommands[2]],
        SessionStart: [{ hooks: [
          { type: 'command', command: '/gate/sessionstart-pilot.mjs' },
          { type: 'command', command: 'pd attention --json' },
        ] }],
      },
    }));
    writeFileSync(join(workspace, '.gemini', 'settings.json'), JSON.stringify({ hooks: hookCommands }));
    writeFileSync(join(fakeHome, '.codex', 'config.toml'), `# ${CODEX_PD_MARKER}\n${REGISTERED_TENTACLES.join('\n')}\n`);
    writeFileSync(join(fakeHome, '.gemini', 'hooks.json'), JSON.stringify({ hooks: hookCommands }));
    writeFileSync(join(workspace, '.claude', 'commands', 'squid.md'), 'squid');
    writeFileSync(join(pdHome, 'heartbeat'), 'alive');
    writeFileSync(join(pdHome, 'daemon.pid'), '4242');
    writeFileSync(join(pdHome, 'daemon.ready'), '4242\n');
    for (const name of TENTACLES) {
      writeFileSync(join(pdHome, 'bin', name), 'gate');
      writeFileSync(join(pdHome, 'bin', 'squid', name), 'tentacle');
    }
    writeFileSync(join(pdHome, 'bin', 'pd-statusline'), 'status');
    writeFileSync(join(pdHome, 'squid', 'projects'), `${workspace}\n`);

    const result = readSquidConformance(workspace, {
      home: fakeHome,
      pdHome,
      now: Date.now(),
      commandExists: () => true,
    });

    expect(result.level).toBe('LIVE');
    expect(result.daemonReady).toBe(true);
    expect(result.detectedProviders).toBe(4);
    expect(result.wiredProviders).toBe(4);
    expect(result.providers.every((entry) => entry.wired)).toBe(true);
    expect(result.capabilities.inbox).toBe(true);

    writeFileSync(join(pdHome, 'daemon.ready'), '4241\n');
    const booting = readSquidConformance(workspace, {
      home: fakeHome,
      pdHome,
      now: Date.now(),
      commandExists: () => true,
    });
    expect(booting.level).toBe('READY');
    expect(booting.daemonAlive).toBe(true);
    expect(booting.daemonReady).toBe(false);
  });
});
