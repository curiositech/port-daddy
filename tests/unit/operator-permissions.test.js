/**
 * Unit Tests: Operator Permission Learning (Phase 3)
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createOperatorPermissions } from '../../lib/operator-permissions.js';

let db;
let permissions;

beforeEach(() => {
  db = createTestDb();
  permissions = createOperatorPermissions(db);
});

afterEach(() => {
  db.close();
});

describe('check()', () => {
  test('returns "ask" by default when no patterns exist', () => {
    expect(permissions.check('resurrect', 'port-daddy', 0.02)).toBe('ask');
  });

  test('returns the policy of a matching pattern', () => {
    db.prepare(
      `INSERT INTO operator_permission_patterns
       (kind, project_prefix, policy, approval_count, denial_count, last_seen_at)
       VALUES ('resurrect', 'port-daddy', 'auto', 5, 0, datetime('now'))`
    ).run();

    expect(permissions.check('resurrect', 'port-daddy', 0.02)).toBe('auto');
  });

  test('picks most-specific prefix (longest match wins)', () => {
    db.prepare(
      `INSERT INTO operator_permission_patterns
       (kind, project_prefix, policy, approval_count, denial_count, last_seen_at)
       VALUES ('spawn', '', 'ask', 0, 0, datetime('now'))`
    ).run();
    db.prepare(
      `INSERT INTO operator_permission_patterns
       (kind, project_prefix, policy, approval_count, denial_count, last_seen_at)
       VALUES ('spawn', 'port-daddy', 'auto', 3, 0, datetime('now'))`
    ).run();

    expect(permissions.check('spawn', 'port-daddy:fleet:main', 0.01)).toBe('auto');
    expect(permissions.check('spawn', 'other-project', 0.01)).toBe('ask');
  });

  test('kind is scoped — different kind returns ask even if project matches', () => {
    db.prepare(
      `INSERT INTO operator_permission_patterns
       (kind, project_prefix, policy, approval_count, denial_count, last_seen_at)
       VALUES ('resurrect', 'port-daddy', 'auto', 5, 0, datetime('now'))`
    ).run();

    expect(permissions.check('spawn', 'port-daddy', 0.01)).toBe('ask');
  });
});

describe('record()', () => {
  test('creates a new pattern row on first approval', () => {
    permissions.record('resurrect', 'port-daddy', 0.02, 'approved');
    const patterns = permissions.list();
    expect(patterns).toHaveLength(1);
    expect(patterns[0].approvalCount).toBe(1);
    expect(patterns[0].denialCount).toBe(0);
    expect(patterns[0].policy).toBe('ask');
  });

  test('increments denial count on denial', () => {
    permissions.record('resurrect', 'port-daddy', 0.02, 'denied');
    const patterns = permissions.list();
    expect(patterns[0].denialCount).toBe(1);
    expect(patterns[0].approvalCount).toBe(0);
  });

  test('sets suggestedAt after 3 consecutive approvals', () => {
    permissions.record('resurrect', 'port-daddy', 0.02, 'approved');
    permissions.record('resurrect', 'port-daddy', 0.02, 'approved');

    expect(permissions.listCandidates()).toHaveLength(0);

    permissions.record('resurrect', 'port-daddy', 0.02, 'approved');

    const candidates = permissions.listCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].kind).toBe('resurrect');
    expect(candidates[0].approvalCount).toBe(3);
    expect(candidates[0].message).toContain('3');
  });

  test('approve→deny→approve resets streak: 3rd approval after a denial does not produce a candidate', () => {
    // approve twice, then deny, then approve once more — total approvals would be 3 but
    // the streak was broken by the denial, so suggestedAt must NOT be set
    permissions.record('resurrect', 'port-daddy', 0.02, 'approved');
    permissions.record('resurrect', 'port-daddy', 0.02, 'approved');
    permissions.record('resurrect', 'port-daddy', 0.02, 'denied'); // breaks streak, resets to 0
    permissions.record('resurrect', 'port-daddy', 0.02, 'approved'); // only 1 in new streak

    expect(permissions.listCandidates()).toHaveLength(0);
    const patterns = permissions.list();
    expect(patterns[0].approvalCount).toBe(1); // streak restarted from zero
  });

  test('denial resets approval_count to zero', () => {
    permissions.record('resurrect', 'port-daddy', 0.02, 'approved');
    permissions.record('resurrect', 'port-daddy', 0.02, 'approved');
    permissions.record('resurrect', 'port-daddy', 0.02, 'denied');

    const patterns = permissions.list();
    expect(patterns[0].approvalCount).toBe(0);
    expect(patterns[0].denialCount).toBe(1);
    expect(patterns[0].suggestedAt).toBeNull();
  });

  test('does not re-set suggestedAt once accepted_at is set', () => {
    // Approve 3 times, accept, then approve more
    permissions.record('resurrect', 'port-daddy', 0.02, 'approved');
    permissions.record('resurrect', 'port-daddy', 0.02, 'approved');
    permissions.record('resurrect', 'port-daddy', 0.02, 'approved');
    const candidates = permissions.listCandidates();
    permissions.accept(candidates[0].id);

    // 4th approval should not re-suggest (already accepted)
    permissions.record('resurrect', 'port-daddy', 0.02, 'approved');
    expect(permissions.listCandidates()).toHaveLength(0);
  });
});

describe('accept() and denyMeta()', () => {
  function setupCandidate() {
    for (let i = 0; i < 3; i++) {
      permissions.record('spawn', 'my-project', 0.01, 'approved');
    }
    return permissions.listCandidates()[0];
  }

  test('accept() flips policy to "auto"', () => {
    const candidate = setupCandidate();
    permissions.accept(candidate.id);

    const patterns = permissions.list();
    expect(patterns[0].policy).toBe('auto');
    expect(permissions.listCandidates()).toHaveLength(0);
  });

  test('denyMeta() resets suggestedAt and approval count', () => {
    const candidate = setupCandidate();
    permissions.denyMeta(candidate.id);

    expect(permissions.listCandidates()).toHaveLength(0);
    const patterns = permissions.list();
    expect(patterns[0].approvalCount).toBe(0);
    expect(patterns[0].policy).toBe('ask');
  });

  test('check() returns "auto" after accept()', () => {
    const candidate = setupCandidate();
    permissions.accept(candidate.id);

    expect(permissions.check('spawn', 'my-project', 0.01)).toBe('auto');
  });
});

describe('listCandidates()', () => {
  test('returns empty array when no candidates', () => {
    expect(permissions.listCandidates()).toHaveLength(0);
  });

  test('candidate message includes kind and project', () => {
    for (let i = 0; i < 3; i++) {
      permissions.record('resurrect', 'my-project', 0.02, 'approved');
    }
    const candidates = permissions.listCandidates();
    expect(candidates[0].message).toContain('resurrect');
    expect(candidates[0].message).toContain('my-project');
  });
});
