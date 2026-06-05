/**
 * `pd periscope` — the Sight stage of the operator loop.
 *
 * "Raise the periscope": one command that answers "what's the state, what's
 * next" by composing live daemon truth (/status + roadmap 'now' head) into a
 * single glance. The formatting is a PURE function so it's exhaustively
 * testable without a daemon; the handler just fetches + feeds it.
 */

import { describe, test, expect } from '@jest/globals';
import { composePeriscope } from '../../cli/commands/periscope.js';

const FULL = {
  status: {
    version: '3.17.0',
    uptimeHuman: '2h 14m',
    status: 'ok',
    fleet: { running: true, totalAgents: 3, totalLaunchableAgents: 2, projects: [{ name: 'acme', agents: 2 }, { name: 'pd', agents: 1 }] },
  },
  roadmapNow: { items: [
    { slug: 'a', title: 'Decide what acme is', status: 'now' },
    { slug: 'b', title: 'Wire checkout flow', status: 'now' },
    { slug: 'c', title: 'Add tests', status: 'now' },
  ] },
  guard: { mode: 'enforce', ok: true },
};

describe('composePeriscope (pure)', () => {
  test('returns lines, never throws, includes the daemon version + uptime', () => {
    const out = composePeriscope(FULL);
    expect(Array.isArray(out)).toBe(true);
    const text = out.join('\n');
    expect(text).toContain('3.17.0');
    expect(text).toContain('2h 14m');
  });

  test('surfaces the next cut (top roadmap "now" item) prominently', () => {
    const text = composePeriscope(FULL).join('\n');
    expect(text).toContain('Decide what acme is');
  });

  test('reports fleet running + agent count', () => {
    const text = composePeriscope(FULL).join('\n');
    expect(text).toMatch(/3 agent/);
  });

  test('degraded daemon status is shown, not hidden', () => {
    const text = composePeriscope({ ...FULL, status: { ...FULL.status, status: 'degraded' } }).join('\n');
    expect(text.toLowerCase()).toContain('degraded');
  });

  test('empty roadmap → an explicit "nothing queued" cue, not a blank', () => {
    const text = composePeriscope({ status: FULL.status, roadmapNow: { items: [] } }).join('\n');
    expect(text.toLowerCase()).toMatch(/no .*(next|roadmap|cut|queued)|nothing/);
  });

  test('daemon unreachable (null status) degrades gracefully', () => {
    const out = composePeriscope({ status: null, roadmapNow: null });
    expect(Array.isArray(out)).toBe(true);
    expect(out.join('\n').toLowerCase()).toMatch(/unreachable|offline|no daemon|down/);
  });

  test('guard mode is surfaced when known', () => {
    const text = composePeriscope(FULL).join('\n');
    expect(text.toLowerCase()).toContain('enforce');
  });
});
