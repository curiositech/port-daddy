import { describe, expect, it } from 'vitest';
import { latestSessionPlan, orderSessionNotes, requestedSessionId, safeEvidenceHref, sessionDetailHref, verifySessionDetail } from './sessionPlan';
import type { StoryNote } from './types';

const note = (id: number, type = 'todo_list', createdAt = id): StoryNote => ({ id, type, createdAt, sessionId: 'session-exact', content: `note ${id}` });

describe('exact session plan projection', () => {
  it('selects the newest complete typed plan after more than three older notes', () => {
    const notes = [note(1), note(2, 'progress'), note(3), note(4, 'handoff'), { ...note(5), content: '- [x] Build\n- [ ] Review\n- [ ] Merge' }, note(6, 'progress')];
    expect(latestSessionPlan(notes)?.content).toBe('- [x] Build\n- [ ] Review\n- [ ] Merge');
    expect(orderSessionNotes(notes).map((item) => item.id)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(notes[0].id).toBe(1);
  });

  it('breaks clock ties with stable note IDs and does not infer plans from progress', () => {
    expect(orderSessionNotes([note(2, 'progress', 10), note(4, 'progress', 10), note(3, 'progress', 10)]).map((item) => item.id)).toEqual([4, 3, 2]);
    expect(latestSessionPlan([{ ...note(9, 'progress'), content: '- [x] Not a plan revision' }])).toBeNull();
  });

  it('preserves explicit empty and encoded selectors, never identity/cwd guesses', () => {
    expect(requestedSessionId(new URLSearchParams('surface=sessions&session=session-1&agent=other'))).toBe('session-1');
    expect(requestedSessionId(new URLSearchParams('session='))).toBe('');
    expect(requestedSessionId(new URLSearchParams('agent=agent-nearby&project=/same/root'))).toBeNull();
    expect(new URLSearchParams(sessionDetailHref('session-a&agent=wrong').slice(1)).get('session')).toBe('session-a&agent=wrong');
    expect(new URLSearchParams(sessionDetailHref('session-a&agent=wrong').slice(1)).has('agent')).toBe(false);
  });

  it('rejects mismatched sessions and differently attributed notes', () => {
    const data = { success: true, session: { id: 'session-exact' }, notes: [note(1)] };
    expect(verifySessionDetail(data, 'session-exact').notes).toEqual([note(1)]);
    expect(() => verifySessionDetail(data, 'session-other')).toThrow('requested session');
    expect(() => verifySessionDetail({ ...data, notes: [{ ...note(1), sessionId: 'session-other' }] }, 'session-exact')).toThrow('differently attributed');
    expect(() => verifySessionDetail({ ...data, notes: undefined }, 'session-exact')).toThrow('complete notes');
  });

  it('keeps the chosen daemon when an exact link is opened on another origin', () => {
    const href = sessionDetailHref('session-same-id', 'http://127.0.0.1:43210');
    const opened = new URL(href, 'http://127.0.0.1:9876/fleet-ui/');
    expect(opened.searchParams.get('daemon')).toBe('http://127.0.0.1:43210');
    expect(opened.searchParams.get('session')).toBe('session-same-id');
    expect([...opened.searchParams.keys()]).toEqual(['surface', 'session', 'daemon']);
  });

  it.each(['javascript:alert(1)', 'data:text/html,hello', 'file:///private/a', '//evil.test', 'https://u:p@example.test', '/relative/path'])('leaves unsafe evidence targets inert: %s', (target) => {
    expect(safeEvidenceHref(target)).toBeNull();
  });

  it('allows normal web evidence without embedded credentials', () => {
    expect(safeEvidenceHref('https://github.com/example/demo/pull/2')).toBe('https://github.com/example/demo/pull/2');
  });
});
