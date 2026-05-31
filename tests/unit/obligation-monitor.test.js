import { createTestDb } from '../setup-unit.js';
import { createCommitments } from '../../lib/commitments.js';
import { createObligationMonitor, OBLIGATION_OVERDUE } from '../../lib/obligation-monitor.js';

let db;
let clock;
let commitments;
let monitor;
let logged;

const HOUR = 60 * 60 * 1000;

function makeActivityLog() {
  logged = [];
  return {
    log(type, options) {
      logged.push({ type, options });
      return { success: true };
    },
  };
}

beforeEach(() => {
  db = createTestDb();
  clock = 1_700_000_000_000;
  commitments = createCommitments(db, { now: () => clock });
  monitor = createObligationMonitor(db, { activityLog: makeActivityLog() });
});

afterEach(() => {
  db.close();
});

describe('checkOverdue', () => {
  test('finds an open commitment past its due_at', () => {
    const c = commitments.create({ ownerActorId: 'a', objectText: 'do it', scope: 'claim' });
    // Sweep at a time after the derived deadline.
    const result = monitor.checkOverdue(c.dueAt + 1);
    expect(result.count).toBe(1);
    expect(result.overdue[0].id).toBe(c.id);
    expect(result.overdue[0].overdueByMs).toBe(1);
  });

  test('ignores a future commitment (not yet due)', () => {
    const c = commitments.create({ ownerActorId: 'a', objectText: 'later', scope: 'standing' });
    const result = monitor.checkOverdue(c.dueAt - HOUR);
    expect(result.count).toBe(0);
  });

  test('ignores a closed commitment even when its deadline has passed (Law 2 closure)', () => {
    const c = commitments.create({ ownerActorId: 'a', objectText: 'done early', scope: 'claim' });
    commitments.close(c.id, 'sha:cafef00d');
    const result = monitor.checkOverdue(c.dueAt + HOUR);
    expect(result.count).toBe(0);
  });

  test('emits OBLIGATION_OVERDUE on the activity stream per overdue commitment', () => {
    const c = commitments.create({ ownerActorId: 'agent-9', objectText: 'ship', scope: 'claim' });
    monitor.checkOverdue(c.dueAt + 5_000);
    const events = logged.filter((e) => e.type === OBLIGATION_OVERDUE);
    expect(events).toHaveLength(1);
    expect(events[0].options.agentId).toBe('agent-9');
    expect(events[0].options.targetId).toBe(c.id);
    expect(events[0].options.metadata.commitmentId).toBe(c.id);
  });

  test('caller supplies the clock — a non-finite now is rejected (Law 1)', () => {
    expect(() => monitor.checkOverdue(NaN)).toThrow(/finite number/);
    expect(() => monitor.checkOverdue(undefined)).toThrow(/finite number/);
  });

  test('emits at most once per breach across repeated sweeps (dedup marker)', () => {
    const c = commitments.create({ ownerActorId: 'a', objectText: 'ship', scope: 'claim' });
    monitor.checkOverdue(c.dueAt + 1_000);
    monitor.checkOverdue(c.dueAt + 2_000);
    monitor.checkOverdue(c.dueAt + 3_000);
    const events = logged.filter((e) => e.type === OBLIGATION_OVERDUE);
    expect(events).toHaveLength(1);
  });

  test('emit:false detects overdue without writing activity events (safe GET)', () => {
    const c = commitments.create({ ownerActorId: 'a', objectText: 'ship', scope: 'claim' });
    const result = monitor.checkOverdue(c.dueAt + 1_000, { emit: false });
    expect(result.count).toBe(1);
    expect(logged.filter((e) => e.type === OBLIGATION_OVERDUE)).toHaveLength(0);
    // A subsequent emitting sweep still fires once (the marker was untouched).
    monitor.checkOverdue(c.dueAt + 2_000, { emit: true });
    expect(logged.filter((e) => e.type === OBLIGATION_OVERDUE)).toHaveLength(1);
  });

  test('mixed: only the overdue-open subset is returned', () => {
    const overdue = commitments.create({ ownerActorId: 'a', objectText: 'overdue', scope: 'claim' });
    const future = commitments.create({ ownerActorId: 'a', objectText: 'future', scope: 'standing' });
    const closed = commitments.create({ ownerActorId: 'a', objectText: 'closed', scope: 'claim' });
    commitments.close(closed.id, 'test:passed#123');

    const sweepAt = overdue.dueAt + 1; // past claim deadline, before standing deadline
    expect(sweepAt).toBeLessThan(future.dueAt);
    const result = monitor.checkOverdue(sweepAt);
    expect(result.count).toBe(1);
    expect(result.overdue[0].id).toBe(overdue.id);
  });
});
