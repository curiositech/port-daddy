import { describe, it, expect } from 'vitest';
import { renderFindingsComment, type FindingsRenderCtx } from '../src/findings-render.js';
import type { Finding } from '../src/verdict.js';

const CTX: FindingsRenderCtx = {
  owner: 'curiositech',
  repo: 'port-daddy',
  prNumber: 731,
  shipName: 'code-reviewer',
};

const f = (over: Partial<Finding>): Finding => ({
  path: 'src/a.ts',
  line: 10,
  severity: 'MEDIUM',
  body: 'something',
  ...over,
});

describe('renderFindingsComment', () => {
  it('empty findings → empty string (silence, not a bare "[]")', () => {
    // This is the red-team fix: a clean ship renders to nothing, and the caller
    // posts nothing instead of dumping "[]".
    expect(renderFindingsComment([], CTX)).toBe('');
  });

  it('renders readable markdown, NOT the raw JSON the operator saw truncated', () => {
    const out = renderFindingsComment([f({ line: 42, body: 'off-by-one in loop' })], CTX);
    // The location + body are legible; no fenced ```json array in the visible body.
    expect(out).toContain('`src/a.ts:42`');
    expect(out).toContain('off-by-one in loop');
    // The only JSON present is the HIDDEN machine block, inside an HTML comment.
    expect(out).not.toContain('```json');
    expect(out).toContain('<!-- pd-findings-json');
  });

  it('groups by severity, HIGH before MEDIUM before LOW', () => {
    const out = renderFindingsComment(
      [
        f({ severity: 'LOW', body: 'low one' }),
        f({ severity: 'HIGH', body: 'high one' }),
        f({ severity: 'MEDIUM', body: 'medium one' }),
      ],
      CTX,
    );
    expect(out.indexOf('HIGH')).toBeLessThan(out.indexOf('MEDIUM'));
    expect(out.indexOf('MEDIUM')).toBeLessThan(out.indexOf('LOW'));
  });

  it('a HIGH finding gets a one-click prefilled-issue URL; MEDIUM/LOW do not', () => {
    const high = renderFindingsComment([f({ severity: 'HIGH', body: 'auth bypass' })], CTX);
    expect(high).toContain('[📌 Open as issue](https://github.com/curiositech/port-daddy/issues/new');
    expect(high).toContain('labels=bug,from-fleet');
    // The finding body rides into the prefilled issue (percent-encoded).
    expect(high).toContain(encodeURIComponent('auth bypass'));

    const med = renderFindingsComment([f({ severity: 'MEDIUM', body: 'nit' })], CTX);
    expect(med).not.toContain('Open as issue');
  });

  it('percent-encodes model text so it cannot break out of the URL query string', () => {
    const out = renderFindingsComment(
      [f({ severity: 'HIGH', body: 'bad & "quoted" <thing> #42' })],
      CTX,
    );
    const urlLine = out.split('\n').find(l => l.includes('issues/new'))!;
    // No raw ampersand/quote/space injected into the query beyond the URL structure.
    const query = urlLine.slice(urlLine.indexOf('issues/new'));
    expect(query).not.toContain('"quoted"');
    expect(query).not.toContain('<thing>');
  });

  it('the hidden machine block survives model text containing "-->" (no early comment termination)', () => {
    const out = renderFindingsComment([f({ body: 'evil --> <!-- injected' })], CTX);
    const block = out.slice(out.indexOf('<!-- pd-findings-json'));
    // The raw comment body must not contain a literal terminator before its end.
    const inner = block.replace(/^<!-- pd-findings-json\n/, '').replace(/\n-->$/, '');
    expect(inner).not.toContain('-->');
    expect(inner).not.toContain('<!--');
    // And it still round-trips to the original text through JSON.parse.
    const parsed = JSON.parse(inner) as Array<{ body: string }>;
    expect(parsed[0].body).toBe('evil --> <!-- injected');
  });

  it('is deterministic — same input, byte-identical output (idempotent edit-in-place)', () => {
    const findings = [f({ severity: 'HIGH', body: 'a' }), f({ severity: 'LOW', body: 'b' })];
    expect(renderFindingsComment(findings, CTX)).toBe(renderFindingsComment(findings, CTX));
  });

  it('reports the finding count in the footer', () => {
    expect(renderFindingsComment([f({}), f({ line: 11 })], CTX)).toContain('2 findings');
    expect(renderFindingsComment([f({})], CTX)).toContain('1 finding from pd-code-reviewer');
  });
});
