/**
 * Capture-skew invariant (docs/FLEET-SESSION-TRANSCRIPTS.md, "Risks"): a model
 * call site added WITHOUT the runCaptured wrapper silently disappears from
 * session transcripts, and nothing else would ever notice — the run still
 * works, the receipt still renders, only the forensics are gone. This test
 * walks every `*.AI.run(` / `*.ai.run(` call site in the executor's source and
 * fails unless the site is either wrapped (a `runCaptured(` appears within the
 * preceding lines) or carries an explicit
 * `// transcript-capture: exempt (<reason>)` marker. Same discipline as the
 * map-reduce invariants: the contract lives in the source, the test keeps it
 * honest as the code moves.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** How far above a call site the wrapper or exempt marker may sit. */
const LOOKBACK_LINES = 14;

/** Matches a Workers AI invocation (NOT D1's `.prepare(...).run()` etc.). */
const AI_CALL_RE = /\b(?:env\.AI|opts\.ai|ai)\.run\(/;

describe('transcript capture skew', () => {
  it('every Workers AI call site is runCaptured-wrapped or explicitly exempt', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(SRC_DIR)) {
      if (!file.endsWith('.ts')) continue;
      // The wrapper module itself is the one legitimate naked caller boundary.
      if (file === 'transcript-capture.ts') continue;
      const lines = readFileSync(join(SRC_DIR, file), 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!AI_CALL_RE.test(lines[i])) continue;
        // Prose mentions in comments are not call sites.
        const trimmed = lines[i].trimStart();
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
        const windowStart = Math.max(0, i - LOOKBACK_LINES);
        const window = lines.slice(windowStart, i + 1).join('\n');
        const wrapped = window.includes('runCaptured(');
        const exempt = window.includes('transcript-capture: exempt');
        if (!wrapped && !exempt) {
          offenders.push(`${file}:${i + 1}: ${lines[i].trim()}`);
        }
      }
    }
    expect(
      offenders,
      'Unwrapped Workers AI call site(s): wrap with runCaptured(...) from ' +
        'src/transcript-capture.ts, or add "// transcript-capture: exempt ' +
        '(<reason>)" within the preceding lines. See ' +
        'docs/FLEET-SESSION-TRANSCRIPTS.md.',
    ).toEqual([]);
  });

  it('the wrapper is actually adopted (not everything exempted away)', () => {
    let wrappedSites = 0;
    for (const file of readdirSync(SRC_DIR)) {
      if (!file.endsWith('.ts') || file === 'transcript-capture.ts') continue;
      const text = readFileSync(join(SRC_DIR, file), 'utf8');
      wrappedSites += (text.match(/runCaptured\(/g) ?? []).length;
    }
    // MAP + REDUCE + repair (execute.ts) and the purser chokepoint at minimum.
    expect(wrappedSites).toBeGreaterThanOrEqual(4);
  });
});
