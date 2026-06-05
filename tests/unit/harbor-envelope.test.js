/**
 * Unit tests for lib/harbor-envelope.ts
 *
 * The envelope is the vacuum-sealed environment a harbor defines: which
 * filesystem roots, tools, skills, MCP servers, LLM backends, and channels
 * an agent inside the harbor may touch, plus a spend ceiling.
 *
 * The single invariant that matters: FAIL CLOSED. An action is denied unless
 * the envelope explicitly admits it. An empty allowlist denies everything; a
 * `['*']` wildcard is the only way to open a dimension. A missing/garbage
 * envelope normalizes to deny-all, never allow-all.
 *
 * Every verdict carries a human-readable `boundary` so the permission edge
 * can be shown to the operator (ADR-linked, gates #190).
 */

import {
  assessEnvelope,
  parseEnvelope,
  emptyEnvelope,
  OPEN_ENVELOPE,
} from '../../lib/harbor-envelope.js';

describe('harbor-envelope: defaults are deny-all (fail closed)', () => {
  test('emptyEnvelope denies every dimension', () => {
    const env = emptyEnvelope();
    expect(assessEnvelope(env, { kind: 'tool', name: 'Bash' }).allowed).toBe(false);
    expect(assessEnvelope(env, { kind: 'skill', name: 'port-daddy' }).allowed).toBe(false);
    expect(assessEnvelope(env, { kind: 'mcp', name: 'serena' }).allowed).toBe(false);
    expect(assessEnvelope(env, { kind: 'backend', name: 'claude' }).allowed).toBe(false);
    expect(assessEnvelope(env, { kind: 'channel', name: 'global' }).allowed).toBe(false);
    expect(assessEnvelope(env, { kind: 'fs', op: 'read', path: '/etc/passwd' }).allowed).toBe(false);
  });

  test('a deny verdict names the boundary it tripped', () => {
    const v = assessEnvelope(emptyEnvelope(), { kind: 'tool', name: 'Bash' });
    expect(v.allowed).toBe(false);
    expect(v.boundary).toBe('tools');
    expect(typeof v.reason).toBe('string');
    expect(v.reason.length).toBeGreaterThan(0);
  });

  test('unknown action kind is denied, not crashed', () => {
    const v = assessEnvelope(emptyEnvelope(), { kind: 'wormhole', name: 'x' });
    expect(v.allowed).toBe(false);
    expect(v.boundary).toBe('unknown');
  });
});

describe('harbor-envelope: allowlists are exact-match over structured ids', () => {
  const env = parseEnvelope({
    tools: ['Bash', 'Read', 'Edit'],
    skills: ['port-daddy'],
    mcps: ['serena'],
    backends: ['claude', 'cli:claude-code'],
    channels: ['global', 'port-daddy:fleet'],
  });

  test('listed names are allowed', () => {
    expect(assessEnvelope(env, { kind: 'tool', name: 'Bash' }).allowed).toBe(true);
    expect(assessEnvelope(env, { kind: 'backend', name: 'cli:claude-code' }).allowed).toBe(true);
    expect(assessEnvelope(env, { kind: 'channel', name: 'port-daddy:fleet' }).allowed).toBe(true);
  });

  test('unlisted names are denied', () => {
    expect(assessEnvelope(env, { kind: 'tool', name: 'WebFetch' }).allowed).toBe(false);
    expect(assessEnvelope(env, { kind: 'backend', name: 'openai' }).allowed).toBe(false);
  });

  test('matching is case-sensitive and exact (no substring leakage)', () => {
    expect(assessEnvelope(env, { kind: 'tool', name: 'bash' }).allowed).toBe(false);
    expect(assessEnvelope(env, { kind: 'tool', name: 'Ba' }).allowed).toBe(false);
    expect(assessEnvelope(env, { kind: 'channel', name: 'global2' }).allowed).toBe(false);
  });

  test('a wildcard opens exactly its own dimension', () => {
    const wild = parseEnvelope({ tools: ['*'], skills: [] });
    expect(assessEnvelope(wild, { kind: 'tool', name: 'anything' }).allowed).toBe(true);
    expect(assessEnvelope(wild, { kind: 'skill', name: 'anything' }).allowed).toBe(false);
  });
});

describe('harbor-envelope: filesystem containment', () => {
  const env = parseEnvelope({ filesystem: ['/Users/erichowens/coding/port-daddy'] });

  test('paths inside a root are allowed', () => {
    expect(assessEnvelope(env, { kind: 'fs', op: 'read', path: '/Users/erichowens/coding/port-daddy/lib/db.ts' }).allowed).toBe(true);
    expect(assessEnvelope(env, { kind: 'fs', op: 'write', path: '/Users/erichowens/coding/port-daddy/x.txt' }).allowed).toBe(true);
  });

  test('the root itself is allowed', () => {
    expect(assessEnvelope(env, { kind: 'fs', op: 'read', path: '/Users/erichowens/coding/port-daddy' }).allowed).toBe(true);
  });

  test('paths outside a root are denied', () => {
    expect(assessEnvelope(env, { kind: 'fs', op: 'read', path: '/etc/passwd' }).allowed).toBe(false);
    expect(assessEnvelope(env, { kind: 'fs', op: 'read', path: '/Users/erichowens/coding/other-repo/x' }).allowed).toBe(false);
  });

  test('traversal escapes are denied (fail closed)', () => {
    expect(assessEnvelope(env, { kind: 'fs', op: 'write', path: '/Users/erichowens/coding/port-daddy/../secret' }).allowed).toBe(false);
    expect(assessEnvelope(env, { kind: 'fs', op: 'read', path: '/Users/erichowens/coding/port-daddy/../../etc/passwd' }).allowed).toBe(false);
  });

  test('a sibling whose name prefixes the root is NOT inside it', () => {
    // /coding/port-daddy-evil must not be treated as inside /coding/port-daddy
    expect(assessEnvelope(env, { kind: 'fs', op: 'read', path: '/Users/erichowens/coding/port-daddy-evil/x' }).allowed).toBe(false);
  });

  test('wildcard filesystem root opens all paths', () => {
    const wild = parseEnvelope({ filesystem: ['*'] });
    expect(assessEnvelope(wild, { kind: 'fs', op: 'write', path: '/etc/passwd' }).allowed).toBe(true);
  });

  test('empty filesystem denies all paths', () => {
    expect(assessEnvelope(emptyEnvelope(), { kind: 'fs', op: 'read', path: '/anything' }).allowed).toBe(false);
  });
});

describe('harbor-envelope: budget ceiling', () => {
  test('null budget is unlimited', () => {
    const env = parseEnvelope({ budgetUsd: null });
    expect(assessEnvelope(env, { kind: 'spend', amountUsd: 9999, priorUsd: 0 }).allowed).toBe(true);
  });

  test('spend within the remaining ceiling is allowed', () => {
    const env = parseEnvelope({ budgetUsd: 10 });
    expect(assessEnvelope(env, { kind: 'spend', amountUsd: 3, priorUsd: 5 }).allowed).toBe(true);
  });

  test('spend that would exceed the ceiling is denied', () => {
    const env = parseEnvelope({ budgetUsd: 10 });
    const v = assessEnvelope(env, { kind: 'spend', amountUsd: 6, priorUsd: 5 });
    expect(v.allowed).toBe(false);
    expect(v.boundary).toBe('budget');
  });

  test('spend exactly to the ceiling is allowed (boundary inclusive)', () => {
    const env = parseEnvelope({ budgetUsd: 10 });
    expect(assessEnvelope(env, { kind: 'spend', amountUsd: 5, priorUsd: 5 }).allowed).toBe(true);
  });

  test('negative or NaN amounts are denied (fail closed)', () => {
    const env = parseEnvelope({ budgetUsd: 10 });
    expect(assessEnvelope(env, { kind: 'spend', amountUsd: -1, priorUsd: 0 }).allowed).toBe(false);
    expect(assessEnvelope(env, { kind: 'spend', amountUsd: NaN, priorUsd: 0 }).allowed).toBe(false);
  });

  test('priorUsd defaults to 0 when omitted', () => {
    const env = parseEnvelope({ budgetUsd: 10 });
    expect(assessEnvelope(env, { kind: 'spend', amountUsd: 10 }).allowed).toBe(true);
    expect(assessEnvelope(env, { kind: 'spend', amountUsd: 11 }).allowed).toBe(false);
  });
});

describe('harbor-envelope: parseEnvelope normalizes hostile input to deny-all', () => {
  test('null/undefined → empty (deny-all) envelope', () => {
    for (const bad of [null, undefined, 42, 'nope', []]) {
      const env = parseEnvelope(bad);
      expect(assessEnvelope(env, { kind: 'tool', name: 'Bash' }).allowed).toBe(false);
      expect(env.budgetUsd).toBe(0); // deny-all: zero budget, not unlimited
    }
  });

  test('non-array allowlist fields coerce to empty (deny), not throw', () => {
    const env = parseEnvelope({ tools: 'Bash', skills: { x: 1 } });
    expect(assessEnvelope(env, { kind: 'tool', name: 'Bash' }).allowed).toBe(false);
    expect(assessEnvelope(env, { kind: 'skill', name: 'x' }).allowed).toBe(false);
  });

  test('non-string entries are dropped from allowlists', () => {
    const env = parseEnvelope({ tools: ['Bash', 42, null, { x: 1 }, 'Read'] });
    expect(assessEnvelope(env, { kind: 'tool', name: 'Bash' }).allowed).toBe(true);
    expect(assessEnvelope(env, { kind: 'tool', name: 'Read' }).allowed).toBe(true);
  });

  test('round-trips through JSON', () => {
    const env = parseEnvelope({ tools: ['Bash'], budgetUsd: 5, filesystem: ['/x'] });
    const restored = parseEnvelope(JSON.parse(JSON.stringify(env)));
    expect(assessEnvelope(restored, { kind: 'tool', name: 'Bash' }).allowed).toBe(true);
    expect(assessEnvelope(restored, { kind: 'spend', amountUsd: 6 }).allowed).toBe(false);
  });

  test('OPEN_ENVELOPE is the explicit opt-out (everything allowed)', () => {
    expect(assessEnvelope(OPEN_ENVELOPE, { kind: 'tool', name: 'x' }).allowed).toBe(true);
    expect(assessEnvelope(OPEN_ENVELOPE, { kind: 'fs', op: 'write', path: '/etc/x' }).allowed).toBe(true);
    expect(assessEnvelope(OPEN_ENVELOPE, { kind: 'spend', amountUsd: 1e9 }).allowed).toBe(true);
  });
});
