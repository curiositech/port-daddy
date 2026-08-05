/**
 * The harness-context capture must stay bound to the REAL hook.
 *
 * This capture exists to back a public claim — "here is exactly what Port Daddy
 * puts in your agent's context window" — so the one thing that must never
 * happen is the numbers drifting from `bin/pd-hook-prompt`. Every prior version
 * of this demo was staged strings, which is why it could drift silently and why
 * nobody could trust the byte counts.
 *
 * These tests assert the properties a reader would be relying on, not the exact
 * wording, so ordinary copy edits to the hook do not break them while a change
 * in BEHAVIOUR does.
 */
import { describe, expect, test } from '@jest/globals';

import { captureAll } from '../../scripts/capture-harness-context.js';

const captures = captureAll();
const byId = new Map(captures.map((c) => [c.id, c]));

describe('captures come from the real hook', () => {
  test('every scenario produced a capture', () => {
    expect(captures.length).toBeGreaterThanOrEqual(6);
  });

  test('output is Claude Code UserPromptSubmit JSON, not free text', () => {
    // If the hook's envelope shape ever changes, the marketing page would
    // silently render the wrong thing — better to fail here.
    const speaking = captures.find((c) => !c.silent)!;
    const parsed = JSON.parse(speaking.raw.trim());
    expect(parsed.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(typeof parsed.hookSpecificOutput.additionalContext).toBe('string');
  });

  test('reported bytes equal the real injected string', () => {
    for (const c of captures) {
      expect(c.bytes).toBe(Buffer.byteLength(c.injected, 'utf8'));
    }
  });
});

describe('the quiet harness is genuinely quiet', () => {
  test('steady state with an empty fleet injects NOTHING', () => {
    // The property every other scenario depends on. If this regresses, the
    // block prints on every turn and agents learn to skim it.
    const quiet = byId.get('quiet')!;
    expect(quiet.silent).toBe(true);
    expect(quiet.bytes).toBe(0);
  });

  test('the first turn costs a little, and that is shown rather than hidden', () => {
    // Caught by this capture itself: the plan directive is rate-limited per
    // actor, so an actor's first turn always carries it. A capture that ran the
    // hook once would have reported the harness as never silent.
    const first = byId.get('first-turn')!;
    expect(first.silent).toBe(false);
    expect(first.bytes).toBeGreaterThan(0);
    expect(first.bytes).toBeLessThan(quietBudget);
  });

  const quietBudget = 200; // an idle first turn must stay small
});

describe('what an agent actually reads', () => {
  test('a directed message is addressed to this actor', () => {
    expect(byId.get('inbox')!.injected).toContain('FOR YOU');
  });

  test('a file collision names the file and the other agent', () => {
    const c = byId.get('collision')!;
    expect(c.injected).toContain('lib/squid/reconcile.ts');
    expect(c.injected).toContain('alpha');
  });

  test('a parley summons names the reason', () => {
    expect(byId.get('parley')!.injected).toContain('PARLEY');
  });

  test('HALT is rendered FIRST, above everything else', () => {
    // An agent that reads nothing else must still read this one.
    const halt = byId.get('halt')!;
    expect(halt.injected).toContain('HALT');
    expect(halt.lines[0]).toContain('HALT');
  });

  test('nothing an agent reads carries an embedded newline mid-entry', () => {
    // The same string rides a flat KEY="value" matrix line; a stray newline
    // would terminate the line the POSIX hook is parsing.
    for (const c of captures) {
      for (const line of c.lines) expect(line).not.toContain('\n');
    }
  });
});

describe('the context cost stays honest', () => {
  test('no single scenario is a context hog', () => {
    // This rides on EVERY turn. A surface that costs a kilobyte per turn is one
    // an operator will rightly turn off.
    for (const c of captures) {
      expect(c.bytes).toBeLessThan(1024);
    }
  });

  test('the loudest scenario is still under half a kilobyte', () => {
    const loudest = captures.reduce((a, b) => (b.bytes > a.bytes ? b : a));
    expect(loudest.bytes).toBeLessThan(512);
  });
});
