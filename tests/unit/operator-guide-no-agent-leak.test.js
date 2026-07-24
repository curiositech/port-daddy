/**
 * Anti-leak guard for the operator-only emergency raw-git escape guide.
 *
 * The guide (docs/operator/emergency-raw-git-escape.md) documents the human
 * operator's genuine emergency path: invoking the real git binary by
 * absolute path when the daemon is down. That path is deliberately kept out
 * of every agent-facing surface — a bypass documented to agents is not a
 * control (ADR-0102). The moment this guide, or its raw-git resolution
 * recipe, appears anywhere under skills/, agents can mint the escape and the
 * whole point is lost.
 *
 * This test is the structural enforcement of that boundary. It fails if:
 *   1. the operator guide is missing, or has been moved under skills/;
 *   2. the guide's operator-only sentinel leaks into any skill file;
 *   3. the raw-git resolution recipe leaks into any skill file.
 *
 * It intentionally does NOT ban every mention of PD_SHIM_OFF from skill
 * docs: the agent-facing git-discipline reference names PD_SHIM_OFF in order
 * to DISCOURAGE it ("the same class of mistake as --no-verify"), which is a
 * legitimate warning, not a recipe. What must never leak is the operator's
 * raw-git recovery path, which is the actual secret this guide holds.
 */
import { describe, expect, test } from '@jest/globals';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const GUIDE_REL = 'docs/operator/emergency-raw-git-escape.md';
const GUIDE_ABS = join(REPO_ROOT, GUIDE_REL);
const SKILLS_DIR = join(REPO_ROOT, 'skills');

// The operator-only sentinel embedded at the top of the guide. Distinctive
// enough that any copy/mirror of the guide is caught by a substring scan.
const SENTINEL = 'OPERATOR-ONLY: DO NOT MIRROR TO AGENT-FACING SKILL SURFACES';

// The raw-git resolution recipe. This exact incantation is what turns "there
// is a real git somewhere" into "here is how to bypass the shim", so it is
// the string that must never appear on an agent surface.
const RAW_GIT_RECIPE = "command -v -a git | grep -v '\\.port-daddy'";

/** Recursively collect text files under a directory. */
function walkTextFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTextFiles(full));
    } else if (entry.isFile()) {
      // Text-ish surfaces an agent could read. Skip binaries/large assets.
      if (/\.(md|mdx|markdown|txt|json|ya?ml|ts|js|sh)$/i.test(entry.name)) {
        try {
          if (statSync(full).size < 2_000_000) out.push(full);
        } catch {
          /* ignore unreadable */
        }
      }
    }
  }
  return out;
}

describe('operator raw-git escape guide is operator-only', () => {
  test('the guide exists at its operator location', () => {
    expect(existsSync(GUIDE_ABS)).toBe(true);
  });

  test('the guide lives under docs/operator, never under skills/', () => {
    // Placement invariant: an operator runbook, not an agent skill doc.
    expect(GUIDE_REL.startsWith('docs/operator/')).toBe(true);
    expect(GUIDE_REL).not.toMatch(/(^|\/)skills\//);
    // And no copy of it exists inside the skills tree.
    const leaked = existsSync(SKILLS_DIR)
      ? walkTextFiles(SKILLS_DIR).filter((f) => f.endsWith('emergency-raw-git-escape.md'))
      : [];
    expect(leaked).toEqual([]);
  });

  test('the guide carries its operator-only sentinel and non-escape rules', () => {
    const body = readFileSync(GUIDE_ABS, 'utf8');
    expect(body).toContain(SENTINEL);
    expect(body).toContain(RAW_GIT_RECIPE);
    // The four required guarantees are present.
    expect(body).toMatch(/still\s+BLOCKED/i); // protected force-push stays blocked
    expect(body).toMatch(/binary-agnostic/i); // pre-push hook reasoning
    expect(body).toMatch(/same[-\s]?UID/i); // honest containment caveat
    expect(body).toMatch(/escalate to the operator/i); // agent non-escape guidance
  });

  test('no skill surface leaks the sentinel or the raw-git recipe', () => {
    if (!existsSync(SKILLS_DIR)) return; // no skills tree → nothing to leak
    const offenders = [];
    for (const file of walkTextFiles(SKILLS_DIR)) {
      let text;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      if (text.includes(SENTINEL) || text.includes(RAW_GIT_RECIPE)) {
        offenders.push(file.slice(REPO_ROOT.length + 1));
      }
    }
    // If this fails, the operator-only guide (or its recipe) has leaked into
    // an agent-facing skill surface. Remove it from skills/ — do not weaken
    // this test. See docs/operator/emergency-raw-git-escape.md.
    expect(offenders).toEqual([]);
  });
});
