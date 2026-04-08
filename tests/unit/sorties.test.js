import { createTestDb } from '../setup-unit.js';
import { createSorties } from '../../lib/sorties.js';

let db;
let sorties;

beforeEach(() => {
  db = createTestDb();
  sorties = createSorties(db);
});

afterEach(() => {
  db.close();
});

describe('sorties store', () => {
  test('creates, lists, updates, and logs sortie missions', () => {
    const sortie = sorties.create({
      projectDir: '/tmp/port-daddy',
      project: 'port-daddy',
      harbor: 'port-daddy:sortie:pending',
      goal: 'Investigate flaky auth tests',
      recipe: 'investigate',
      backend: 'codex',
      modelTier: 'low',
      budgetUsd: 0.75,
      expectedOutput: 'Root-cause memo',
      metadata: { approvalMode: 'before-close' },
    });

    expect(sortie.id).toMatch(/^sortie-/);
    expect(sortie.status).toBe('planned');
    expect(sortie.startedAt).toBeNull();

    const listed = sorties.list({ projectDir: '/tmp/port-daddy' });
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(sortie.id);

    const running = sorties.update(sortie.id, {
      harbor: `port-daddy:sortie:${sortie.id}`,
      status: 'running',
      model: 'gpt-5.4-mini',
      modelTier: 'low',
      startedAt: 123,
      metadata: { approvalMode: 'before-close', preflight: { launchReady: true } },
    });
    expect(running?.harbor).toBe(`port-daddy:sortie:${sortie.id}`);
    expect(running?.startedAt).toBe(123);

    const event = sorties.addEvent(sortie.id, 'sortie:planned', 'Mission planned', { recipe: 'investigate' });
    expect(event.sortieId).toBe(sortie.id);

    const completed = sorties.update(sortie.id, {
      status: 'completed',
      spawnAgentId: 'spawned-123',
      resultOutput: 'Done',
      completedAt: 456,
    });
    expect(completed?.spawnAgentId).toBe('spawned-123');
    expect(completed?.completedAt).toBe(456);

    const events = sorties.events(sortie.id, 10);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('sortie:planned');
  });
});
