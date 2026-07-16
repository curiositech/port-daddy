import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { probeHarnessAdapters } from '../../lib/harness-adapter-probe.js';

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function tempDir() {
  const directory = mkdtempSync(join(tmpdir(), 'pd-harness-probe-'));
  tempDirs.push(directory);
  return directory;
}

function catalogEntry(adapter) {
  return {
    id: 'fixture',
    name: 'Fixture',
    costModel: 'local',
    framing: 'fixture',
    description: 'fixture',
    models: [],
    adapter,
  };
}

test('discovers advertised CLI flags and path presence without claiming conformance', () => {
  const home = tempDir();
  const transcriptRoot = join(home, 'sessions');
  const fixture = join(home, 'help-fixture.mjs');
  writeFileSync(fixture, `
    const mode = process.argv[2];
    if (mode === 'spawn') console.log('SPAWN_EVIDENCE initial-prompt');
    else if (mode === 'resume') console.log('RESUME_EVIDENCE session-id');
    else process.exit(2);
  `);
  mkdirSync(transcriptRoot);

  const report = probeHarnessAdapters([
    catalogEntry({
      family: 'fixture-cli',
      spawn: {
        transport: 'agent-cli',
        command: { executable: process.execPath, args: ['{prompt}'], promptTransport: 'argument' },
      },
      resume: {
        native: true,
        scope: 'session',
        command: { executable: process.execPath, args: ['{sessionId}', '{prompt}'], promptTransport: 'argument' },
      },
      acceptsInitialPrompt: true,
      interactiveChannels: ['terminal'],
      transcript: { format: 'custom', owner: 'harness', stability: 'documented', root: transcriptRoot },
      authModes: ['local-none'],
      limitations: ['fixture only'],
      probe: {
        executable: process.execPath,
        spawnHelpArgs: [fixture, 'spawn'],
        spawnEvidence: ['SPAWN_EVIDENCE', 'initial-prompt'],
        resumeHelpArgs: [fixture, 'resume'],
        resumeEvidence: ['RESUME_EVIDENCE', 'session-id'],
      },
    }),
  ], {
    resolveExecutable: () => ({
      command: process.execPath,
      found: true,
      source: 'discovered',
    }),
    now: () => new Date('2026-07-15T00:00:00.000Z'),
  });

  expect(report).toMatchObject({
    probedAt: '2026-07-15T00:00:00.000Z',
    sideEffectFree: true,
    evidenceLevel: 'discovery-only',
    provesCapabilities: false,
    adapters: [{
      family: 'fixture-cli',
      executablePath: process.execPath,
      spawn: { status: 'discovered' },
      resume: { status: 'discovered' },
      transcript: { status: 'discovered' },
    }],
  });
  expect(report.counts.discovered).toBe(3);
  expect(report.adapters[0].spawn.detail).toContain('no spawn or model turn was executed');
  expect(report.adapters[0].transcript.detail).toContain('contents and format were not validated');
  expect(JSON.stringify(report)).not.toContain('witnessed');
});

test('fails honestly when a declared executable is unavailable', () => {
  const report = probeHarnessAdapters([
    catalogEntry({
      family: 'missing-cli',
      spawn: {
        transport: 'agent-cli',
        command: { executable: 'missing-cli', args: ['{prompt}'], promptTransport: 'argument' },
      },
      resume: {
        native: true,
        scope: 'session',
        command: { executable: 'missing-cli', args: ['{sessionId}', '{prompt}'], promptTransport: 'argument' },
      },
      acceptsInitialPrompt: true,
      interactiveChannels: ['terminal'],
      transcript: { format: 'none', owner: 'none', stability: 'none' },
      authModes: ['delegated-cli'],
      limitations: ['fixture only'],
      probe: {
        executable: 'missing-cli',
        spawnHelpArgs: ['--help'],
        spawnEvidence: ['spawn'],
        resumeHelpArgs: ['resume', '--help'],
        resumeEvidence: ['resume'],
      },
    }),
  ], {
    resolveExecutable: () => ({ command: 'missing-cli', found: false, source: 'unresolved' }),
  });

  expect(report.adapters[0]).toMatchObject({
    executablePath: null,
    spawn: { status: 'unavailable' },
    resume: { status: 'unavailable' },
    transcript: { status: 'not-supported' },
  });
});

test('keeps provider transports unverified instead of promoting catalog claims', () => {
  const report = probeHarnessAdapters([
    catalogEntry({
      family: 'fixture-api',
      spawn: { transport: 'provider-http' },
      resume: { native: false, scope: 'none' },
      acceptsInitialPrompt: true,
      interactiveChannels: ['http'],
      transcript: { format: 'port-daddy-jsonl', owner: 'port-daddy', stability: 'internal' },
      authModes: ['api-key'],
      limitations: ['fixture only'],
    }),
  ]);

  expect(report.adapters[0]).toMatchObject({
    spawn: { status: 'unverified' },
    resume: { status: 'not-supported' },
    transcript: { status: 'unverified' },
  });
});

describe('negative evidence', () => {
  test('marks a successful help command unverified when expected evidence is absent', () => {
    const report = probeHarnessAdapters([
      catalogEntry({
        family: 'drifted-cli',
        spawn: { transport: 'agent-cli' },
        resume: { native: false, scope: 'none' },
        acceptsInitialPrompt: true,
        interactiveChannels: ['terminal'],
        transcript: { format: 'none', owner: 'none', stability: 'none' },
        authModes: ['delegated-cli'],
        limitations: ['fixture only'],
        probe: {
          executable: process.execPath,
          spawnHelpArgs: ['--help'],
          spawnEvidence: ['IMPOSSIBLE_EVIDENCE'],
        },
      }),
    ], {
      resolveExecutable: () => ({ command: process.execPath, found: true, source: 'discovered' }),
    });

    expect(report.adapters[0].spawn).toMatchObject({ status: 'unverified' });
    expect(report.adapters[0].spawn.detail).toContain('IMPOSSIBLE_EVIDENCE');
  });
});
