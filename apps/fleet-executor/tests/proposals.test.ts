import { describe, it, expect } from 'vitest';
import {
  parseProposals,
  renderProposalComment,
  slugify,
  ideationOutputContract,
  type Proposal,
} from '../src/proposals.js';

const CTX = { owner: 'curiositech', repo: 'port-daddy', prNumber: 42, shipName: 'spider' };

describe('parseProposals — validated ideation schema', () => {
  it('returns [] when there is no json block (nothing proposed)', () => {
    expect(parseProposals('just some prose, no fence\n\nFLEET-VERDICT: PASS')).toEqual([]);
    expect(parseProposals('')).toEqual([]);
  });

  it('returns [] for an explicit empty array', () => {
    expect(parseProposals('```json\n[]\n```\n\nFLEET-VERDICT: PASS')).toEqual([]);
  });

  it('parses a well-formed proposal array', () => {
    const out = [
      '```json',
      JSON.stringify([
        {
          title: 'Add live roster',
          rationale: 'A + B implies C',
          evidence: ['lib/a.ts', 'lib/b.ts'],
          action: 'assign',
          prompt: 'Build the live roster.',
        },
      ]),
      '```',
      'FLEET-VERDICT: PASS',
    ].join('\n');
    const parsed = parseProposals(out);
    expect(parsed).not.toBeNull();
    expect(parsed).toHaveLength(1);
    expect(parsed![0]).toEqual({
      title: 'Add live roster',
      rationale: 'A + B implies C',
      evidence: ['lib/a.ts', 'lib/b.ts'],
      action: 'assign',
      prompt: 'Build the live roster.',
      severity: undefined,
    });
  });

  it('coerces severity and drops non-string evidence', () => {
    const out = [
      '```json',
      JSON.stringify([
        { title: 'T', rationale: 'R', evidence: ['ok', 123, null], action: 'roadmap', severity: 'med' },
      ]),
      '```',
    ].join('\n');
    const parsed = parseProposals(out)!;
    expect(parsed[0].evidence).toEqual(['ok']);
    expect(parsed[0].severity).toBe('MEDIUM');
  });

  it('returns null (errored) for malformed JSON inside the fence', () => {
    expect(parseProposals('```json\n{ not an array\n```')).toBeNull();
  });

  it('returns null when a required field is missing or the action is unknown', () => {
    expect(
      parseProposals('```json\n' + JSON.stringify([{ title: 'T', rationale: 'R', action: 'nope' }]) + '\n```'),
    ).toBeNull();
    expect(
      parseProposals('```json\n' + JSON.stringify([{ title: '', rationale: 'R', action: 'roadmap' }]) + '\n```'),
    ).toBeNull();
    expect(
      parseProposals('```json\n' + JSON.stringify([{ title: 'T', action: 'roadmap' }]) + '\n```'),
    ).toBeNull();
  });

  it('returns null when a non-string prompt is supplied', () => {
    expect(
      parseProposals(
        '```json\n' + JSON.stringify([{ title: 'T', rationale: 'R', action: 'assign', prompt: 5 }]) + '\n```',
      ),
    ).toBeNull();
  });
});

describe('renderProposalComment — REAL actionable syntax', () => {
  const p = (over: Partial<Proposal>): Proposal => ({
    title: 'Title Here',
    rationale: 'Because reasons.',
    evidence: ['src/x.ts'],
    action: 'roadmap',
    ...over,
  });

  it('renders nothing for an empty proposal set (silence)', () => {
    expect(renderProposalComment([], CTX)).toBe('');
  });

  it('roadmap → a GitHub prefilled-issue URL and a pd roadmap upsert command with a VALID status', () => {
    const body = renderProposalComment([p({ action: 'roadmap' })], CTX);
    expect(body).toContain('https://github.com/curiositech/port-daddy/issues/new?title=');
    expect(body).toContain('labels=roadmap,from-fleet');
    // Status must be one the CLI actually accepts (now|backlog|parked|merge|done);
    // `next` would error when pasted.
    expect(body).toContain('pd roadmap upsert title-here --summary "Title Here" --status backlog');
    expect(body).not.toContain('--status next');
  });

  it('assign → a runnable pd dispatch propose command and a paste-able prompt', () => {
    const body = renderProposalComment(
      [p({ action: 'assign', prompt: 'Do the specific build.' })],
      CTX,
    );
    expect(body).toContain('pd dispatch propose "Do the specific build." --tags from-fleet,pd-spider');
    expect(body).toContain('pd dispatch run <id>');
    expect(body).toContain('Ready-to-paste agent prompt');
  });

  it('skill → a pd dispatch propose that invokes the skill-architect skill', () => {
    const body = renderProposalComment(
      [p({ action: 'skill', prompt: 'make harbor fixtures trivial to author', title: 'Harbor fixture kit' })],
      { ...CTX, shipName: 'snipe' },
    );
    // "build a skill. Goal: <brief>" reads naturally for a verb-led brief
    // ("make …"), unlike the ungrammatical "a skill that make …".
    expect(body).toContain('Use the skill-architect skill to build a skill. Goal: make harbor fixtures trivial to author');
    expect(body).toContain('--tags skill,from-fleet,pd-snipe');
    expect(body).toContain('Skill-architect brief');
  });

  it('escapes shell metacharacters in untrusted model text so the pasted command cannot run substitutions', () => {
    const body = renderProposalComment(
      [
        p({
          action: 'assign',
          title: 'Injection attempt',
          prompt: 'do $(rm -rf /) and `whoami` and $HOME and a "quote"',
        }),
      ],
      CTX,
    );
    // The `pd dispatch propose "…"` COMMAND line wraps the goal in double quotes,
    // so $, backtick, backslash and the inner quote are all backslash-escaped —
    // pasting it can't trigger $(...) / `…` substitution or break out of the
    // quotes. (The separate <details> code-fence echoes the raw prompt verbatim;
    // that's documentation, not a runnable command.)
    const escapedGoal = 'do \\$(rm -rf /) and \\`whoami\\` and \\$HOME and a \\"quote\\"';
    expect(body).toContain(`pd dispatch propose "${escapedGoal}"`);
  });

  it('renders a severity badge for trouble-ahead proposals (lookout)', () => {
    const body = renderProposalComment(
      [p({ action: 'roadmap', severity: 'HIGH', title: 'Contradiction ahead' })],
      { ...CTX, shipName: 'lookout' },
    );
    expect(body).toContain('### ⚠ Contradiction ahead `HIGH`');
  });

  it('embeds a machine-readable pd-proposals-json block for downstream handlers', () => {
    const body = renderProposalComment([p({})], CTX);
    expect(body).toContain('<!-- pd-proposals-json');
    const m = /<!-- pd-proposals-json\n([\s\S]*?)\n-->/.exec(body);
    expect(m).not.toBeNull();
    const arr = JSON.parse(m![1]);
    expect(arr[0].n).toBe(1);
    expect(arr[0].title).toBe('Title Here');
  });

  it('is deterministic: same input → byte-identical output (idempotent edit-in-place)', () => {
    const a = renderProposalComment([p({ action: 'assign', prompt: 'x' })], CTX);
    const b = renderProposalComment([p({ action: 'assign', prompt: 'x' })], CTX);
    expect(a).toBe(b);
  });
});

describe('slugify + contract', () => {
  it('slugifies titles into kebab-case', () => {
    expect(slugify('Add Live Roster!')).toBe('add-live-roster');
    expect(slugify('   ')).toBe('proposal');
  });

  it('the ideation contract names the schema fields and the three actions', () => {
    const c = ideationOutputContract();
    for (const field of ['title', 'rationale', 'evidence', 'action', 'prompt', 'severity']) {
      expect(c).toContain(field);
    }
    for (const action of ['roadmap', 'assign', 'skill']) {
      expect(c).toContain(action);
    }
  });
});
