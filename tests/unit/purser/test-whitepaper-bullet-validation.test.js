// tests/unit/purser/test-whitepaper-bullet-validation.test.js
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the markdown file under test
const whitepaperPath = path.resolve(__dirname, '../../docs/roadmap/whitepaper-research-program.md');
const content = fs.readFileSync(whitepaperPath, 'utf8');

// Locate the receipt contract section
const heading = '# whitepaper publication receipt contract';
const start = content.indexOf(heading);
if (start < 0) {
  throw new Error('Receipt contract heading not found');
}
const end = content.indexOf('\n### ', start + heading.length);
const section = start >= 0 ? content.slice(start, end >= 0 ? end : undefined) : '';
const normalizedSection = section.replace(/\s+/gu, ' ');

// Extract bullet lines
const bullets = section
  .split('\n')
  .filter((line) => line.trimStart().startsWith('- '))
  .map((line) => line.trim().replace(/\s+/gu, ' '));

// Receipt clauses and non‑receipt evidence terms (same patterns as the production test)
const RECEIPT_CLAUSES = [
  { name: 'landed source', terms: [/source commit/iu, /edition/iu] },
  {
    name: 'collected volume',
    terms: [/route/iu, /page count/iu, /byte count/iu, /SHA-256/iu],
  },
  { name: 'each standalone paper', terms: [/route/iu, /SHA-256/iu, /standalone/iu] },
  {
    name: 'production deployment',
    terms: [/deployment identifier/iu, /verification timestamp/iu],
  },
];
const NON_RECEIPT_EVIDENCE = [/preview/iu, /local build/iu, /CI artifact/iu];

describe('whitepaper publication receipt contract', () => {
  it('appears exactly once in the document', () => {
    const count = content.split(heading).length - 1;
    assert.strictEqual(count, 1, `section appears ${count} times`);
  });

  it('has at least as many bullets as receipt clauses', () => {
    assert.ok(bullets.length >= RECEIPT_CLAUSES.length,
      `expected at least ${RECEIPT_CLAUSES.length} bullets, found ${bullets.length}`);
  });

  it('binds each receipt clause to exactly one bullet', () => {
    for (const { name, terms } of RECEIPT_CLAUSES) {
      const matches = bullets.filter((bullet) => terms.every((t) => t.test(bullet)));
      assert.strictEqual(
        matches.length,
        1,
        `exactly one receipt bullet must record "${name}" (${terms.map(t => t.source).join(', ')}); found ${matches.length}`
      );
    }
  });

  it('ensures no bullet satisfies more than one clause', () => {
    bullets.forEach((bullet, idx) => {
      const matches = RECEIPT_CLAUSES.filter(({ terms }) => terms.every((t) => t.test(bullet)));
      assert.ok(
        matches.length <= 1,
        `bullet ${idx + 1} matches multiple clauses: ${matches.map(c => c.name).join(', ')}`
      );
    });
  });

  it('ensures receipt bullets contain only terms from their clause', () => {
    // Build a map of clause to its matched bullet
    const clauseToBullet = {};
    for (const { name, terms } of RECEIPT_CLAUSES) {
      const matched = bullets.find((b) => terms.every((t) => t.test(b)));
      clauseToBullet[name] = matched;
    }

    // For each bullet, ensure it does not contain terms from any other clause
    bullets.forEach((bullet, idx) => {
      RECEIPT_CLAUSES.forEach(({ name, terms }) => {
        if (bullet === clauseToBullet[name]) return; // skip its own clause
        const hasOther = terms.some((t) => t.test(bullet));
        if (hasOther) {
          assert.fail(`bullet ${idx + 1} contains terms from clause "${name}" which should be separate`);
        }
      });
    });
  });

  it('contains all non‑receipt evidence terms', () => {
    NON_RECEIPT_EVIDENCE.forEach((term) => {
      assert.match(normalizedSection, term, `section must mention evidence "${term.source}"`);
    });
  });

  it('does not mix non‑receipt evidence into receipt bullets', () => {
    bullets.forEach((bullet, idx) => {
      NON_RECEIPT_EVIDENCE.forEach((term) => {
        if (term.test(bullet)) {
          assert.fail(`bullet ${idx + 1} contains non‑receipt evidence term "${term.source}"`);
        }
      });
    });
  });
});