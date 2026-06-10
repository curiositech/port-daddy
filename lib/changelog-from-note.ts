/**
 * Rent-note → changelog (closing the loop the compulsion opened).
 *
 * The compulsion (ADR-0050 phase 7) makes a coordination note mandatory per
 * commit. That guarantees structured raw material at commit granularity — which
 * is exactly what an auto-changelog never reliably had. This module turns a note
 * into a changelog entry, but ONLY by structured, author-controlled opt-in:
 *
 *   - an explicit `--changelog` flag, or
 *   - a leading Conventional-Commit token the author chose to write
 *     ("feat: …", "fix(scope): …", "breaking!: …").
 *
 * This is NOT prose classification. We never scan free text for keywords — the
 * trigger is an exact-match enum token at the very start of the note (a tag the
 * author controls) or an explicit flag. A note with no such token and no flag is
 * never recorded. One note, two purposes: it pays coordination rent AND, when
 * the author marks it, files a changelog entry.
 */

export type ChangelogType = 'feature' | 'fix' | 'breaking' | 'docs' | 'refactor' | 'chore';

export const CHANGELOG_TYPES: readonly ChangelogType[] = [
  'feature',
  'fix',
  'breaking',
  'docs',
  'refactor',
  'chore',
];

/** Author-controlled Conventional-Commit tokens → changelog type. Exact-match
 *  enum, not a keyword heuristic: only a token written as the leading `tok:` is
 *  honored. */
const CONVENTIONAL: Readonly<Record<string, ChangelogType>> = {
  feat: 'feature',
  feature: 'feature',
  fix: 'fix',
  bugfix: 'fix',
  breaking: 'breaking',
  docs: 'docs',
  doc: 'docs',
  refactor: 'refactor',
  perf: 'refactor',
  chore: 'chore',
  build: 'chore',
  ci: 'chore',
  test: 'chore',
};

export interface ChangelogIntent {
  /** Whether this note should also file a changelog entry. */
  record: boolean;
  type: ChangelogType;
  /** One-line summary (the note's first line, minus any leading token). */
  summary: string;
  /** Detailed body (lines after the first), if any. */
  description?: string;
}

function coerceType(value: string | undefined): ChangelogType | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if ((CHANGELOG_TYPES as readonly string[]).includes(v)) return v as ChangelogType;
  if (Object.prototype.hasOwnProperty.call(CONVENTIONAL, v)) return CONVENTIONAL[v];
  return null;
}

/**
 * Derive a changelog intent from a note. Pure. Returns `record: false` unless
 * the author opted in (flag) or led with a Conventional-Commit token.
 */
export function deriveChangelogFromNote(input: {
  content: string;
  /** Explicit `--changelog` opt-in. */
  changelog?: boolean;
  /** Explicit `--type` override (changelog type or a conventional token). */
  type?: string;
}): ChangelogIntent {
  const content = (input.content ?? '').trim();
  const nl = content.indexOf('\n');
  const firstLine = (nl === -1 ? content : content.slice(0, nl)).trim();
  const rest = nl === -1 ? '' : content.slice(nl + 1).trim();

  // Parse a leading conventional token: tok / tok(scope) / tok! followed by ':'.
  const m = firstLine.match(/^([A-Za-z]+)(?:\([^)]*\))?(!)?:\s*(.*)$/);
  const token = m ? m[1].toLowerCase() : null;
  const tokenType =
    token && Object.prototype.hasOwnProperty.call(CONVENTIONAL, token) ? CONVENTIONAL[token] : null;
  const bang = Boolean(m && m[2]); // "!" marks a breaking change in Conventional Commits

  const explicitType = coerceType(input.type);
  const record = input.changelog === true || tokenType !== null;

  // Type precedence: explicit override > breaking-bang > token mapping > default.
  const type: ChangelogType = explicitType ?? (bang ? 'breaking' : tokenType ?? 'feature');

  // Summary drops the recognized token prefix; an opt-in note with no token keeps
  // its whole first line.
  const summary = (tokenType !== null && m ? m[3] : firstLine).trim();

  return {
    record,
    type,
    summary,
    description: rest.length > 0 ? rest : undefined,
  };
}
