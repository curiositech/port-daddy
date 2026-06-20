import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { schedule, validateLadder, KIND_RANK } from '../../lib/planner-schedule.js';

const here = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(
  readFileSync(join(here, '../fixtures/planner-schedule-parity-vectors.json'), 'utf8'),
);

describe('planner schedule — parity vectors (canonical truth shared with the Rust kernel)', () => {
  for (const c of V.schedule_cases) {
    test(`schedule: ${c.name}`, () => {
      const got = schedule(c.nodes, c.edges);
      expect(got.ok).toBe(c.expected.ok);
      expect(got.cyclic).toBe(c.expected.cyclic);
      expect(got.makespan).toBe(c.expected.makespan);
      expect(got.order).toEqual(c.expected.order);
      expect(got.criticalPath).toEqual(c.expected.criticalPath);
      expect(got.nodes).toEqual(c.expected.nodes);
    });
  }
});

describe('planner ladder — parity vectors', () => {
  for (const c of V.ladder_cases) {
    test(`ladder: ${c.name}`, () => {
      const got = validateLadder(c.nodes, c.parents);
      expect(got.ok).toBe(c.expected.ok);
      expect(got.violations.map((v) => v.child).sort()).toEqual(
        [...c.expected.violationChildren].sort(),
      );
    });
  }
});

describe('schedule — direct edge cases', () => {
  test('empty graph is a valid empty schedule', () => {
    const r = schedule([], []);
    expect(r.ok).toBe(true);
    expect(r.makespan).toBe(0);
    expect(r.nodes).toEqual([]);
    expect(r.criticalPath).toEqual([]);
  });

  test('duplicate node id fails closed', () => {
    const r = schedule([{ id: 'a' }, { id: 'a' }], []);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/duplicate/i);
  });

  test('edge to unknown node fails closed', () => {
    const r = schedule([{ id: 'a', estimate: 1 }], [{ from: 'a', to: 'ghost' }]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unknown node/i);
  });

  test('negative estimate is treated as zero duration', () => {
    const r = schedule([{ id: 'a', estimate: -5 }], []);
    expect(r.ok).toBe(true);
    expect(r.makespan).toBe(0);
    expect(r.nodes[0].earliestFinish).toBe(0);
  });

  test('result is deterministic regardless of input node/edge order', () => {
    const a = schedule(
      [{ id: 'c', estimate: 4 }, { id: 'a', estimate: 1 }, { id: 'd', estimate: 1 }, { id: 'b', estimate: 2 }],
      [{ from: 'b', to: 'd' }, { from: 'a', to: 'c' }, { from: 'c', to: 'd' }, { from: 'a', to: 'b' }],
    );
    const b = schedule(
      [{ id: 'a', estimate: 1 }, { id: 'b', estimate: 2 }, { id: 'c', estimate: 4 }, { id: 'd', estimate: 1 }],
      [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' }],
    );
    expect(a).toEqual(b);
  });
});

describe('ladder — kind ranks form the fixed spine', () => {
  test('Project < Epic < Story < Task < Subtask; bug/chore at story rank', () => {
    expect(KIND_RANK.project).toBeLessThan(KIND_RANK.epic);
    expect(KIND_RANK.epic).toBeLessThan(KIND_RANK.story);
    expect(KIND_RANK.story).toBeLessThan(KIND_RANK.task);
    expect(KIND_RANK.task).toBeLessThan(KIND_RANK.subtask);
    expect(KIND_RANK.bug).toBe(KIND_RANK.story);
    expect(KIND_RANK.chore).toBe(KIND_RANK.story);
  });

  test('a clean full ladder has no violations', () => {
    const r = validateLadder(
      [
        { id: 'p', kind: 'project' },
        { id: 'e', kind: 'epic' },
        { id: 's', kind: 'story' },
      ],
      [{ parent: 'p', child: 'e' }, { parent: 'e', child: 's' }],
    );
    expect(r.ok).toBe(true);
  });
});
