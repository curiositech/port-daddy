/**
 * AGENTS.md's register verbs against the worker's dispatch table.
 *
 * AGENTS.md is the first file every agent in this repository reads, and its
 * Harbor Work Register section tells them which endpoints to call: read the
 * board, claim before you work, heartbeat while you work, leave a note,
 * release, finish. Those are instructions an agent follows literally.
 *
 * The worker dispatches them from a switch on a parsed action, so renaming one
 * is a one-line edit — and the tests beside it use the same literals, so they
 * would be updated in the same commit and stay green. AGENTS.md would not.
 * The failure mode is quiet and one-sided: every agent keeps POSTing to a verb
 * the relay stopped dispatching, gets a refusal it has no handling for, and
 * the board it was told to write to silently stops recording anything.
 *
 * So this reads the verbs out of the prose rather than restating them, reads
 * the dispatch table out of the worker rather than restating that either, and
 * asserts the first is a subset of the second. It does not assert the reverse:
 * the worker dispatches more than the prose documents (`link`, `state`,
 * `item`, `refresh`), which is fine — AGENTS.md is an agent's briefing, not an
 * API reference, and telling it to list every verb would make it worse.
 */
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

/** The Harbor Work Register section, by its own headings. */
function registerSection() {
  const md = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  const start = md.indexOf('## The Harbor Work Register');
  if (start === -1) throw new Error('AGENTS.md no longer has a "## The Harbor Work Register" section');
  const end = md.indexOf('\n## ', start + 1);
  return md.slice(start, end === -1 ? undefined : end);
}

/**
 * Verbs the prose tells an agent to call, written either as `.../verb` or
 * spelled out against the relay host.
 */
function documentedVerbs() {
  const section = registerSection();
  const verbs = new Set();
  for (const m of section.matchAll(/\.\.\.\/([a-z][a-z-]*)/g)) verbs.add(m[1]);
  for (const m of section.matchAll(/\/v1\/register\/([a-z][a-z-]*)/g)) verbs.add(m[1]);
  return verbs;
}

/** Actions the worker actually dispatches, GET and POST alike. */
function dispatchedVerbs() {
  const src = readFileSync(join(ROOT, 'apps', 'relay', 'src', 'work-register.ts'), 'utf8');
  const verbs = new Set();
  for (const m of src.matchAll(/case '([a-z][a-z-]*)':/g)) verbs.add(m[1]);
  for (const m of src.matchAll(/action === '([a-z][a-z-]*)'/g)) verbs.add(m[1]);
  return verbs;
}

describe('the register AGENTS.md describes is the register the relay serves', () => {
  it('finds verbs on both sides, so a silent extraction failure is not a pass', () => {
    // Both halves are regexes over source. A rename that broke either pattern
    // would empty its set and make the subset check trivially true, which is
    // the one way this test could fail open.
    expect(documentedVerbs().size).toBeGreaterThanOrEqual(6);
    expect(dispatchedVerbs().size).toBeGreaterThanOrEqual(8);
  });

  it('dispatches every verb the prose tells an agent to call', () => {
    const dispatched = dispatchedVerbs();
    const undispatched = [...documentedVerbs()].filter((verb) => !dispatched.has(verb)).sort();
    expect(undispatched).toEqual([]);
  });

  it('still documents the four that free work for the next agent', () => {
    // board and claim are exercised by the relay's own surface test; these
    // four are the ones an abandoned claim depends on, and dropping any of
    // them from the briefing would stop agents releasing what they hold long
    // before anything went red.
    const documented = documentedVerbs();
    for (const verb of ['heartbeat', 'note', 'release', 'finish']) {
      expect(`${verb}: ${documented.has(verb)}`).toBe(`${verb}: true`);
    }
  });
});
