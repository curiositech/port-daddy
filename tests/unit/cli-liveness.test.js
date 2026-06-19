/**
 * Tests for lib/cli-liveness.ts — detecting a MUTE tool as a liveness failure.
 * The rule under test: silence is not success. Zero stdout (any exit code) is a
 * mute-tool failure with a route-around remediation; real output is a pass.
 */
import { describe, it, expect } from '@jest/globals';
import {
  classifySelfSpeech,
  probeCliSelfSpeech,
  CLI_CANARY_SENTINEL,
} from '../../lib/cli-liveness.js';

describe('classifySelfSpeech (pure)', () => {
  it('zero stdout is MUTE even with exit 0', () => {
    const v = classifySelfSpeech({ stdout: '', code: 0 });
    expect(v.speaks).toBe(false);
    expect(v.reason).toMatch(/ZERO stdout/);
    expect(v.remediation).toMatch(/daemon HTTP/);
  });
  it('zero stdout is MUTE with exit 1 too', () => {
    expect(classifySelfSpeech({ stdout: '', code: 1 }).speaks).toBe(false);
  });
  it('whitespace-only stdout is mute', () => {
    expect(classifySelfSpeech({ stdout: '  \n  ', code: 0 }).speaks).toBe(false);
  });
  it('a spawn failure is mute with an install remediation', () => {
    const v = classifySelfSpeech({ stdout: '', code: null, spawnFailed: true });
    expect(v.speaks).toBe(false);
    expect(v.reason).toMatch(/failed to spawn/);
  });
  it('non-empty output speaks', () => {
    expect(classifySelfSpeech({ stdout: '3.17.0\n', code: 0 }).speaks).toBe(true);
  });
  it('output missing the expected token is NOT a pass', () => {
    const v = classifySelfSpeech({ stdout: 'garbage', code: 0 }, CLI_CANARY_SENTINEL);
    expect(v.speaks).toBe(false);
    expect(v.reason).toMatch(/did not echo/);
  });
  it('output containing the expected token passes', () => {
    expect(classifySelfSpeech({ stdout: `x ${CLI_CANARY_SENTINEL} y`, code: 0 }, CLI_CANARY_SENTINEL).speaks).toBe(true);
  });
});

describe('probeCliSelfSpeech (injected spawn)', () => {
  it('reports mute when the injected run returns empty stdout', async () => {
    const v = await probeCliSelfSpeech('/opt/homebrew/bin/pd', {
      run: async () => ({ stdout: '', code: 1 }),
    });
    expect(v.speaks).toBe(false);
    expect(v.remediation).toMatch(/daemon HTTP/);
  });
  it('reports speaking when the injected run returns output', async () => {
    const v = await probeCliSelfSpeech('/opt/homebrew/bin/pd', {
      run: async () => ({ stdout: '3.17.0', code: 0 }),
    });
    expect(v.speaks).toBe(true);
  });
  it('a thrown spawn folds into a mute verdict (never throws)', async () => {
    const v = await probeCliSelfSpeech('pd', { run: async () => { throw new Error('ENOENT'); } });
    expect(v.speaks).toBe(false);
    expect(v.reason).toMatch(/threw|ENOENT/);
  });
  it('defaults to probing --version', async () => {
    let seenArgs;
    await probeCliSelfSpeech('pd', { run: async (_c, args) => { seenArgs = args; return { stdout: 'v', code: 0 }; } });
    expect(seenArgs).toEqual(['--version']);
  });
});
