/**
 * lib/safe/staged-guard.ts — Phase B, the `--staged` / pre-push secret guard
 * (ADR-0088, hooks into the ADR-0053 out-of-band enforcement surface).
 *
 * Reuse the A1 structured-format + entropy scanner against the ADDED lines of
 * `git diff --staged` so a NEW secret is caught at the commit/push boundary —
 * the highest-value, lowest-cost win, because it stops new leaks before they
 * land. NO keyword-NLP: detection is exactly A1's structured-format regex +
 * entropy fallback over the added hunk lines.
 *
 * THE NO-RAW-SECRET RULE holds: a finding carries path/line/ruleId/last4 only;
 * the matched value is never returned, logged, or printed. The diff itself is
 * scanned in-memory and dropped.
 */

import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

import { scanContent } from './secret-scanner.js';
import type { SecretFinding } from './types.js';

/** A staged finding: an A1 {@link SecretFinding} plus the diff-relative path. */
export interface StagedFinding extends SecretFinding {
  /** The repo-relative path the added line belongs to (from the diff header). */
  file: string;
  /** The 1-based NEW-file line number of the added line (from the hunk header). */
  newLine: number;
}

export interface StagedGuardResult {
  /** Findings on ADDED lines in the staged diff. Empty = clean. */
  findings: StagedFinding[];
  /** Repo-relative paths the diff touched (added/modified). */
  files: string[];
  /** True when `git diff` ran and produced a parseable (possibly empty) diff. */
  diffAvailable: boolean;
}

/** Injectable git runner (tests). Returns the raw unified diff, or null. */
export type DiffRunner = (args: string[]) => string | null;

const realDiffRunner: DiffRunner = (args) => {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
};

interface AddedLine {
  file: string;
  newLine: number;
  text: string;
}

/**
 * Parse a unified diff into the ADDED lines only (lines starting with `+`, not
 * the `+++` file header), each tagged with its destination file + new-file line
 * number tracked from the `@@ -a,b +c,d @@` hunk headers. Defensive: tolerates
 * missing/odd headers, binary-file markers, and CRLF.
 */
export function parseAddedLines(diff: string): AddedLine[] {
  const out: AddedLine[] = [];
  let file = '';
  let newLineNo = 0;
  for (const rawLine of diff.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('+++ ')) {
      // `+++ b/path` (or `+++ /dev/null` for a deletion).
      const p = line.slice(4).trim();
      file = p === '/dev/null' ? '' : p.replace(/^b\//, '');
      continue;
    }
    if (line.startsWith('--- ')) continue;
    if (line.startsWith('diff ') || line.startsWith('index ')) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      newLineNo = Number(hunk[1]);
      continue;
    }
    if (line.startsWith('+')) {
      // An added line — scan its content (strip the leading `+`).
      out.push({ file, newLine: newLineNo, text: line.slice(1) });
      newLineNo++;
      continue;
    }
    if (line.startsWith('-')) {
      // A removed line — does not advance the NEW-file counter.
      continue;
    }
    if (line.startsWith(' ')) {
      // Context line — advances the new-file counter.
      newLineNo++;
      continue;
    }
    // `\ No newline at end of file`, mode lines, etc. — ignore.
  }
  return out;
}

export interface ScanStagedOptions {
  /** Operator $HOME (for the A1 known-cred-path entropy gate). */
  home?: string;
  /** Injectable git runner (tests). */
  diff?: DiffRunner;
  /** Extra git args (default: `diff --staged --unified=0 --no-color`). */
  diffArgs?: string[];
}

/**
 * Scan the staged diff's ADDED lines for secrets using the A1 scanner. The added
 * lines for each file are reassembled (in new-file line order) and handed to
 * `scanContent` with the file path — so the entropy fallback fires on known cred
 * paths exactly as it does in a host scan.
 */
export function scanStagedDiff(opts: ScanStagedOptions = {}): StagedGuardResult {
  const home = opts.home ?? homedir();
  const run = opts.diff ?? realDiffRunner;
  const args = opts.diffArgs ?? ['diff', '--staged', '--unified=0', '--no-color'];

  const diff = run(args);
  if (diff == null) {
    return { findings: [], files: [], diffAvailable: false };
  }

  const added = parseAddedLines(diff);
  const files = [...new Set(added.map((a) => a.file).filter(Boolean))];

  const findings: StagedFinding[] = [];
  // Group added lines per file so scanContent sees the file path (drives the
  // entropy gate). We synthesize a content blob of just the added lines and map
  // the synthetic line index back to the real new-file line number.
  const byFile = new Map<string, AddedLine[]>();
  for (const a of added) {
    if (!a.file) continue;
    const arr = byFile.get(a.file) ?? [];
    arr.push(a);
    byFile.set(a.file, arr);
  }

  for (const [file, lines] of byFile) {
    // Scan each added line independently with its real path, so `line` in the
    // A1 finding is the synthetic 1 and we remap to the true new-file line.
    for (const a of lines) {
      const sub = scanContent(file, a.text, home);
      for (const f of sub) {
        findings.push({
          ...f,
          path: file,
          line: a.newLine,
          file,
          newLine: a.newLine,
        });
      }
    }
  }

  return { findings, files, diffAvailable: true };
}

/** A one-line, value-free summary of a staged finding (for the guard message). */
export function formatStagedFinding(f: StagedFinding): string {
  return `${f.file}:${f.newLine}  ${f.ruleId}  (…${f.last4})`;
}
