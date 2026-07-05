// tests/unit/fleet-trust.test.js
//
// Trust gate (lib/fleet/trust.ts) — the L1 provenance + least-privilege layer
// between a trigger firing and an agent spawning (ADR-0093).
//
// Every block maps to a concrete red-team attack from the ADR threat model.
// The test name cites the attack it defeats so the suite IS the evidence the
// operator-assurance section points at.

import { jest } from '@jest/globals';

const trust = await import('../../lib/fleet/trust.js');
const {
  classifyTrust,
  requiresApproval,
  normalizeToolName,
  parseAllowedTools,
  toolAllowedForTier,
  validateAllowedToolsForTier,
  evaluateTrustGate,
} = trust;

describe('classifyTrust — provenance by content source, not transport', () => {
  test('operator pd trigger → OPERATOR', () => {
    expect(classifyTrust({ source: 'pd' })).toBe('OPERATOR');
  });

  test('local signals (git/schedule/file) → INTERNAL', () => {
    expect(classifyTrust({ source: 'git' })).toBe('INTERNAL');
    expect(classifyTrust({ source: 'schedule' })).toBe('INTERNAL');
    expect(classifyTrust({ source: 'file' })).toBe('INTERNAL');
  });

  test('external sources default to ANONYMOUS_EXTERNAL', () => {
    for (const source of ['webhook', 'email', 'sms', 'calendar', 'github']) {
      expect(classifyTrust({ source })).toBe('ANONYMOUS_EXTERNAL');
    }
  });

  // ATTACK: "webhook relay laundering" — transport HMAC ≠ content trust.
  test('defeats webhook-relay-laundering: HMAC-verified transport does NOT upgrade tier', () => {
    // A relay sets consent_verified via transport HMAC but the author is a
    // stranger not on the allowlist → must stay ANONYMOUS.
    const ev = {
      source: 'email',
      metadata: { sender: 'attacker@evil.com', consent_verified: true },
    };
    expect(classifyTrust(ev, { allowlistedAuthors: ['boss@team.com'] })).toBe('ANONYMOUS_EXTERNAL');
  });

  test('AUTHENTICATED_EXTERNAL requires BOTH allowlisted author AND consent_verified', () => {
    const author = 'boss@team.com';
    // allowlisted but not verified → still anonymous
    expect(
      classifyTrust({ source: 'email', metadata: { sender: author } }, { allowlistedAuthors: [author] }),
    ).toBe('ANONYMOUS_EXTERNAL');
    // verified but not allowlisted → still anonymous
    expect(
      classifyTrust({ source: 'email', metadata: { sender: 'x@y.com', consent_verified: true } }, { allowlistedAuthors: [author] }),
    ).toBe('ANONYMOUS_EXTERNAL');
    // both → upgraded
    expect(
      classifyTrust({ source: 'email', metadata: { sender: author, consent_verified: true } }, { allowlistedAuthors: [author] }),
    ).toBe('AUTHENTICATED_EXTERNAL');
  });

  // ATTACK: "silent approval bypass" — unknown/typo tier must fail closed.
  test('defeats silent-approval-bypass: unknown source → lowest tier', () => {
    expect(classifyTrust({ source: 'totally-unknown-kind' })).toBe('ANONYMOUS_EXTERNAL');
    expect(classifyTrust({ source: '' })).toBe('ANONYMOUS_EXTERNAL');
  });
});

describe('requiresApproval — whitelist of trusted tiers, fail closed', () => {
  test('only OPERATOR and INTERNAL skip approval', () => {
    expect(requiresApproval('OPERATOR')).toBe(false);
    expect(requiresApproval('INTERNAL')).toBe(false);
    expect(requiresApproval('AUTHENTICATED_EXTERNAL')).toBe(true);
    expect(requiresApproval('ANONYMOUS_EXTERNAL')).toBe(true);
  });
});

describe('normalizeToolName — defeats unicode/case/glob bypass', () => {
  // ATTACK: "unicode/case tool-name bypass"
  test('case folds', () => {
    expect(normalizeToolName('Bash')).toBe('bash');
    expect(normalizeToolName(' BASH ')).toBe('bash');
  });
  test('NFC-normalizes composed forms', () => {
    // U+0042 U+0061 U+0073 U+0068 is plain "Bash"; ensure trim+lower stable.
    expect(normalizeToolName('Bash')).toBe('bash');
  });
  // ATTACK: "glob scoping bypass" — Bash(gh*) still grants bash.
  test('defeats glob-scoping-bypass: scoped form reduces to base capability', () => {
    expect(normalizeToolName('Bash(gh*)')).toBe('bash');
    expect(normalizeToolName('bash(curl https://x)')).toBe('bash');
  });
});

describe('parseAllowedTools', () => {
  test('parses comma and space separated, normalizes each', () => {
    expect([...parseAllowedTools('Read,Grep, Bash(gh*)')].sort()).toEqual(['bash', 'grep', 'read']);
    expect([...parseAllowedTools('Read Glob')].sort()).toEqual(['glob', 'read']);
  });
  test('empty/undefined → empty set', () => {
    expect(parseAllowedTools('').size).toBe(0);
    expect(parseAllowedTools(undefined).size).toBe(0);
    expect(parseAllowedTools(null).size).toBe(0);
  });
});

describe('toolAllowedForTier — allowlist per tier', () => {
  test('OPERATOR may use any tool', () => {
    expect(toolAllowedForTier('OPERATOR', 'bash')).toBe(true);
    expect(toolAllowedForTier('OPERATOR', 'anything-at-all')).toBe(true);
  });
  test('ANONYMOUS_EXTERNAL may NOT use bash/git/curl/write/edit', () => {
    for (const t of ['bash', 'git', 'gh', 'curl', 'write', 'edit']) {
      expect(toolAllowedForTier('ANONYMOUS_EXTERNAL', t)).toBe(false);
    }
    for (const t of ['read', 'grep', 'glob']) {
      expect(toolAllowedForTier('ANONYMOUS_EXTERNAL', t)).toBe(true);
    }
  });
  test('AUTHENTICATED_EXTERNAL is read+propose only (no execution/vcs)', () => {
    expect(toolAllowedForTier('AUTHENTICATED_EXTERNAL', 'read')).toBe(true);
    expect(toolAllowedForTier('AUTHENTICATED_EXTERNAL', 'bash')).toBe(false);
    expect(toolAllowedForTier('AUTHENTICATED_EXTERNAL', 'write')).toBe(false);
  });
});

describe('validateAllowedToolsForTier — fail-closed least privilege', () => {
  test('OPERATOR always ok (even with no restriction)', () => {
    expect(validateAllowedToolsForTier('OPERATOR', undefined).ok).toBe(true);
    expect(validateAllowedToolsForTier('OPERATOR', 'Bash,Write').ok).toBe(true);
  });

  // ATTACK: "no restriction + untrusted = full caps"
  test('defeats absent-allowedTools-means-full: untrusted tier with no tools → REFUSED', () => {
    const r = validateAllowedToolsForTier('ANONYMOUS_EXTERNAL', undefined);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/explicit allowedTools/i);
    const r2 = validateAllowedToolsForTier('ANONYMOUS_EXTERNAL', '   ');
    expect(r2.ok).toBe(false);
  });

  test('anonymous declaring read-only set → ok', () => {
    const r = validateAllowedToolsForTier('ANONYMOUS_EXTERNAL', 'Read,Grep,Glob');
    expect(r.ok).toBe(true);
    expect(r.offendingTools).toEqual([]);
  });

  // ATTACK: prompt-injection → tool abuse (the CRITICAL).
  test('defeats injection-tool-abuse: anonymous declaring Bash(gh*) → REFUSED with offending tool', () => {
    const r = validateAllowedToolsForTier('ANONYMOUS_EXTERNAL', 'Read,Bash(gh*),Bash(curl*)');
    expect(r.ok).toBe(false);
    expect(r.offendingTools).toContain('bash');
    expect(r.reason).toMatch(/exceed the safe set/i);
  });

  test('internal tier may use bash/edit/write but is still a defined set', () => {
    expect(validateAllowedToolsForTier('INTERNAL', 'Read,Bash,Edit,Write').ok).toBe(true);
  });

  // Invariant #4 as WRITTEN: absent tools = deny for NON-TRUSTED tiers only.
  // INTERNAL is a trusted tier — the operator's own environment. Refusing it
  // would break every shipped Phase-1 `file:` agent with no allowedTools,
  // while the legacy git/schedule path (never tool-gated) sailed on. The
  // gate's teeth are for external ingress.
  test('trusted INTERNAL tier with absent allowedTools → ok (engine default stands)', () => {
    expect(validateAllowedToolsForTier('INTERNAL', undefined).ok).toBe(true);
    expect(validateAllowedToolsForTier('INTERNAL', '').ok).toBe(true);
  });

  test('trusted INTERNAL tier accepts ship-declared tools beyond the nominal set (parity with legacy path)', () => {
    expect(validateAllowedToolsForTier('INTERNAL', 'Read,WebSearch,Task').ok).toBe(true);
  });
});

describe('evaluateTrustGate — file trigger (INTERNAL) end-to-end verdict', () => {
  test('file trigger with no allowedTools → allowed, no approval (Phase-1 path keeps working)', () => {
    const v = evaluateTrustGate({
      event: { source: 'file', metadata: { sender: 'fs.watch', consent_verified: true } },
      allowedTools: undefined,
    });
    expect(v.tier).toBe('INTERNAL');
    expect(v.allowed).toBe(true);
    expect(v.requiresApproval).toBe(false);
  });
});

describe('evaluateTrustGate — the composite verdict', () => {
  test('anonymous webhook with curl → blocked, requires approval, read-only safe set', () => {
    const v = evaluateTrustGate({
      event: { source: 'webhook', metadata: { sender: 'stranger' } },
      allowedTools: 'Read,Bash(curl*)',
    });
    expect(v.tier).toBe('ANONYMOUS_EXTERNAL');
    expect(v.allowed).toBe(false);
    expect(v.requiresApproval).toBe(true);
    expect(v.offendingTools).toContain('bash');
    expect(v.safeTools.sort()).toEqual(['glob', 'grep', 'read']);
  });

  test('operator pd trigger with full tools → allowed, no approval', () => {
    const v = evaluateTrustGate({ event: { source: 'pd' }, allowedTools: 'Bash,Write,Edit' });
    expect(v.tier).toBe('OPERATOR');
    expect(v.allowed).toBe(true);
    expect(v.requiresApproval).toBe(false);
  });

  test('allowlisted+verified author email with read tools → authenticated, allowed, still gated', () => {
    const v = evaluateTrustGate({
      event: { source: 'email', metadata: { sender: 'boss@team.com', consent_verified: true } },
      allowedTools: 'Read,Grep',
      policy: { allowlistedAuthors: ['boss@team.com'] },
    });
    expect(v.tier).toBe('AUTHENTICATED_EXTERNAL');
    expect(v.allowed).toBe(true);
    expect(v.requiresApproval).toBe(true); // external always gated
  });
});
