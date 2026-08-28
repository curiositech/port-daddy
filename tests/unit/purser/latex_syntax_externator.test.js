// tests/unit/purser/latex_syntax_externator.test.js
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Resolve a path relative to the repository root.
 * This file lives in <repo>/tests/unit/purser/, so we go up three levels.
 */
function repoPath(...segments) {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(__filename, '..', '..', '..');
  return path.join(repoRoot, ...segments);
}

/**
 * Load a LaTeX source file as a UTF‑8 string.
 */
function loadTex(relativePath) {
  const fullPath = repoPath(relativePath);
  if (!existsSync(fullPath)) {
    throw new Error(`LaTeX source not found at ${fullPath}`);
  }
  return readFileSync(fullPath, 'utf8');
}

/**
 * Simple brace‑balance check (ignoring comments).
 */
function bracesBalanced(tex) {
  // Strip LaTeX comments first
  const withoutComments = tex.replace(/%.*$/gm, '');
  const open = (withoutComments.match(/{/g) ?? []).length;
  const close = (withoutComments.match(/}/g) ?? []).length;
  return open === close;
}

/**
 * Verify that every \begin{env} has a matching \end{env} in the correct order.
 */
function environmentsBalanced(tex) {
  // Remove comments to avoid false matches inside them
  const clean = tex.replace(/%.*$/gm, '');
  const tokenRegex = /\\(begin|end)\{([^}]+)\}/g;
  const stack = [];

  let match;
  while ((match = tokenRegex.exec(clean)) !== null) {
    const type = match[1]; // "begin" or "end"
    const env = match[2];
    if (type === 'begin') {
      stack.push(env);
    } else {
      const expected = stack.pop();
      if (expected !== env) {
        return false; // mismatched or stray \end
      }
    }
  }
  return stack.length === 0;
}

/**
 * Extract the raw LaTeX source of the section whose title contains `keyword`
 * (case‑insensitive). Returns `null` if not found.
 */
function extractSection(tex, keyword) {
  const sectionRegex = /\\section(?:\[[^\]]*\])?\{([^}]*)\}/gi;
  const sections = [];
  let match;

  while ((match = sectionRegex.exec(tex)) !== null) {
    sections.push({ title: match[1], index: match.index });
  }

  const target = sections.find((s) =>
    s.title.toLowerCase().includes(keyword.toLowerCase())
  );
  if (!target) return null;

  const startIdx = tex.indexOf('\n', target.index) + 1; // after the \section line
  const laterSections = sections
    .filter((s) => s.index > target.index)
    .sort((a, b) => a.index - b.index);
  const endIdx = laterSections.length ? laterSections[0].index : tex.length;

  return tex.slice(startIdx, endIdx).trim();
}

/**
 * Helper to assert that a given section contains a citation key.
 */
function sectionCites(tex, keyword, citationKey) {
  const section = extractSection(tex, keyword);
  if (!section) return false;

  // Accept \cite{...key...}, \citep{...key...}, \citet{...key...}, etc.
  const citePattern = new RegExp(
    `\\\\cite\\w*\\{[^}]*\\b${citationKey}\\b[^}]*\\}|\\[${citationKey}\\]`,
    'i'
  );
  return citePattern.test(section);
}

/* -------------------------------------------------------------------------- */
/*                               Test Suite                                   */
/* -------------------------------------------------------------------------- */

describe('LaTeX syntax and citation integrity for research papers', () => {
  const paper4Path = 'docs/harbor-research/tex/paper4.tex';
  const paper5Path = 'docs/harbor-research/tex/paper5.tex';

  const paper4 = loadTex(paper4Path);
  const paper5 = loadTex(paper5Path);

  test('paper4.tex has balanced curly braces', () => {
    expect(bracesBalanced(paper4)).toBe(true);
  });

  test('paper5.tex has balanced curly braces', () => {
    expect(bracesBalanced(paper5)).toBe(true);
  });

  test('paper4.tex environments are properly opened and closed', () => {
    expect(environmentsBalanced(paper4)).toBe(true);
  });

  test('paper5.tex environments are properly opened and closed', () => {
    expect(environmentsBalanced(paper5)).toBe(true);
  });

  test('paper4.tex contains a "lift" section', () => {
    const sec = extractSection(paper4, 'lift');
    expect(sec).not.toBeNull();
  });

  test('paper5.tex contains an "unraveling-hypothesis" section', () => {
    const sec = extractSection(paper5, 'unraveling-hypothesis');
    expect(sec).not.toBeNull();
  });

  test('paper4.tex "lift" section cites van der Meyden 2007 (vdm07)', () => {
    expect(sectionCites(paper4, 'lift', 'vdm07')).toBe(true);
  });

  test('paper5.tex "unraveling-hypothesis" section cites Lizzeri 1999 (lizzeri99)', () => {
    expect(sectionCites(paper5, 'unraveling-hypothesis', 'lizzeri99')).toBe(true);
  });
});