#!/usr/bin/env python3
"""relocate_exercises.py — move inline pdexercise/pdsolution clusters in a
Harbor Research / Coordination Papers LaTeX chapter into one chapter-end
"Exercises" section, leaving a one-line pointer behind at each original site.

Input: a chapter .tex file whose body contains clusters of

    \\begin{pdexercise}[kind=...,rating=...]{ex:LABEL}
    ...
    \\end{pdexercise}
    \\begin{pdsolution}{ex:LABEL}
    ...
    \\end{pdsolution}

runs (a "cluster" is one or more such exercise/solution pairs separated only
by whitespace), each sitting inside some numbered `\\section{TITLE}` whose
`\\label{...}` (conventionally `sec:...`, though one corpus appendix uses
`app:...`) follows within the next three lines. `\\section*` bodies are
never expected to hold a cluster.

For each cluster the script:
  1. Removes the cluster from its original spot and leaves exactly one
     pointer line, with exactly one blank line before and after it:
       - 2+ exercises: \\pdexercisepointer{\\ref{ex:FIRST}}{\\ref{ex:LAST}}{\\pageref{ex:FIRST}}
       - exactly 1:     \\pdexercisepointerone{\\ref{ex:ONLY}}{\\pageref{ex:ONLY}}
  2. Copies the cluster, byte-identical, into a new terminal
     "\\section{Exercises}" section, grouped under a
     "\\pdexercisefor{\\S\\ref{sec:X}}{TITLE}" heading per source section, in
     body order.

The new section is inserted before the first of, in priority order: a
section titled "Related work", "Open problems", "Conclusion" (prefix match),
"Implementation \\& status", or "Implementation and status"; failing all of
those, before \\pdprintsolutions; failing that, before \\end{document}. If a
"% ═..." comment rule immediately precedes the chosen section, the new
section is inserted before that rule line so rule/section pairs stay glued.

Usage:
    relocate_exercises.py CHAPTER.tex [--prefix PREFIX] [--dry-run] [--check]

Exit codes: 0 success (or already relocated, or a clean --dry-run); 1 write
produced a file that failed --check verification (original is restored); 2
a cluster's enclosing section has no discoverable \\label{sec:...}.
"""

import argparse
import re
import sys
from collections import Counter

RULE_RE = re.compile(r'^%[ \t]*═+[ \t]*$', re.MULTILINE)
RULE_LINE_RE = re.compile(r'%[ \t]*═+[ \t]*')

PAIR_RE = re.compile(
    r'\\begin\{pdexercise\}(?:\[[^\]]*\])?\{(ex:[^}]+)\}.*?\\end\{pdexercise\}'
    r'\s*'
    r'\\begin\{pdsolution\}\{\1\}.*?\\end\{pdsolution\}',
    re.DOTALL,
)

PDEX_LABEL_RE = re.compile(r'\\begin\{pdexercise\}(?:\[[^\]]*\])?\{(ex:[^}]+)\}')
PDSOL_LABEL_RE = re.compile(r'\\begin\{pdsolution\}\{(ex:[^}]+)\}')

SECTION_START_RE = re.compile(r'\\section(\*)?\{')

INSERTION_CANDIDATES = [
    'Related work',
    'Open problems',
    'Conclusion',
    'Implementation \\& status',
    'Implementation and status',
]


class RelocateError(Exception):
    """Raised for a spec-mandated abort (exit code 2)."""


def read_balanced(text, start):
    """text[start-1] is the opening '{'; return (content, index_after_close)."""
    depth = 1
    i = start
    n = len(text)
    while i < n and depth > 0:
        c = text[i]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
        i += 1
    if depth != 0:
        raise RelocateError("unbalanced braces starting near offset %d" % start)
    return text[start:i - 1], i


def find_sections(text):
    """Return a list of section dicts in document order.

    Each: start (offset of the '\\section' token), is_star, title_raw,
    title (newlines collapsed to spaces), label (sec:... or None).
    """
    sections = []
    for m in SECTION_START_RE.finditer(text):
        is_star = bool(m.group(1))
        title_raw, after_brace = read_balanced(text, m.end())
        label = None
        if not is_star:
            # Search a window covering the remainder of the \section line
            # itself plus the next 3 full lines: \label may trail the
            # section command on the same line, or follow on a line of its
            # own within the next few lines.
            idx = after_brace
            for _ in range(4):
                nl = text.find('\n', idx)
                idx = len(text) if nl == -1 else nl + 1
                if nl == -1:
                    break
            window = text[after_brace:idx]
            # Most chapters label sections `sec:...`, but at least one
            # (an appendix using `app:...`) does not; \S\ref{LABEL} works
            # for any label, so accept whatever \label{...} is found.
            lm = re.search(r'\\label\{([^}]+)\}', window)
            if lm:
                label = lm.group(1)
        title = title_raw.replace('\n', ' ')
        sections.append({
            'start': m.start(),
            'is_star': is_star,
            'title_raw': title_raw,
            'title': title,
            'label': label,
        })
    return sections


def section_for_offset(sections, offset):
    """Return the last section (star or not) whose start <= offset, or None."""
    best = None
    for s in sections:
        if s['start'] <= offset:
            best = s
        else:
            break
    return best


def find_clusters(text):
    """Return clusters in document order: list of dicts with start, end,
    labels (ordered), pairs (list of (label, start, end))."""
    pairs = []
    for m in PAIR_RE.finditer(text):
        pairs.append({'label': m.group(1), 'start': m.start(), 'end': m.end()})

    clusters = []
    current = None
    for p in pairs:
        if current is not None:
            gap = text[current['end']:p['start']]
            if gap.strip() == '':
                current['pairs'].append(p)
                current['end'] = p['end']
                continue
        current = {'start': p['start'], 'end': p['end'], 'pairs': [p]}
        clusters.append(current)
    for c in clusters:
        c['labels'] = [p['label'] for p in c['pairs']]
    return clusters


def detect_prefix(clusters):
    tokens = []
    for c in clusters:
        for lbl in c['labels']:
            rest = lbl[len('ex:'):]
            token = rest.split('-', 1)[0]
            tokens.append(token)
    if not tokens:
        return None
    counts = Counter(tokens)
    max_count = max(counts.values())
    for tok in tokens:
        if counts[tok] == max_count:
            return tok
    return tokens[0]


def detect_rule_line(text):
    m = RULE_RE.search(text)
    return m.group(0) if m else None


def pointer_line(cluster):
    labels = cluster['labels']
    if len(labels) == 1:
        return r'\pdexercisepointerone{\ref{%s}}{\pageref{%s}}' % (labels[0], labels[0])
    return r'\pdexercisepointer{\ref{%s}}{\ref{%s}}{\pageref{%s}}' % (
        labels[0], labels[-1], labels[0],
    )


def group_clusters_by_section(text, clusters):
    """Return (groups, errors). groups is an ordered list of dicts:
    {section_label, section_title, clusters: [cluster,...]}."""
    sections = find_sections(text)
    order = []  # section start offsets in first-seen order
    by_start = {}
    for c in clusters:
        sec = section_for_offset(sections, c['start'])
        if sec is None:
            raise RelocateError(
                "cluster at offset %d is not inside any \\section" % c['start']
            )
        if sec['is_star']:
            raise RelocateError(
                "cluster (labels %s) sits inside \\section*{%s}, which the "
                "spec says never happens" % (c['labels'], sec['title'])
            )
        if sec['label'] is None:
            raise RelocateError(
                "section %r has a cluster but no \\label{sec:...} within 3 "
                "lines of \\section" % sec['title']
            )
        key = sec['start']
        if key not in by_start:
            by_start[key] = {
                'section_label': sec['label'],
                'section_title': sec['title'],
                'clusters': [],
            }
            order.append(key)
        by_start[key]['clusters'].append(c)
    return [by_start[k] for k in order], sections


def remove_clusters(text, clusters):
    """Return text with each cluster replaced by its pointer line, exactly
    one blank line before and after, any surrounding blank-line runs
    collapsed."""
    out = []
    pos = 0
    for c in clusters:
        chunk = text[pos:c['start']]
        out.append(chunk.strip('\n \t'))
        out.append('\n\n')
        out.append(pointer_line(c))
        out.append('\n\n')
        pos = c['end']
    tail = text[pos:]
    tail = re.sub(r'\A[ \t]*\n+', '', tail)
    out.append(tail)
    return ''.join(out)


def build_exercises_section(groups, prefix, rule_line):
    lines = []
    if rule_line:
        lines.append(rule_line)
    lines.append(r'\section{Exercises}')
    lines.append(r'\label{sec:%s-exercises}' % prefix)
    if rule_line:
        lines.append(rule_line)
    lines.append('')
    for i, g in enumerate(groups):
        lines.append(
            r'\pdexercisesfor{\S\ref{%s}}{%s}' % (g['section_label'], g['section_title'])
        )
        lines.append('')
        cluster_texts = [text_of_cluster(c) for c in g['clusters']]
        lines.append('\n\n'.join(cluster_texts))
        if i != len(groups) - 1:
            lines.append('')
    return '\n'.join(lines)


def text_of_cluster(c):
    return c['text']


def annotate_cluster_text(text, clusters):
    for c in clusters:
        c['text'] = text[c['start']:c['end']]


def _absorb_preceding_rule(text, offset):
    """If a bare '% ═...' comment rule line sits immediately (no blank line)
    above `offset` (which must itself be the start of a line), move the
    offset to the start of that rule line."""
    before = text[:offset]
    if before.endswith('\n'):
        before = before[:-1]
    last_nl = before.rfind('\n')
    last_line = before[last_nl + 1:]
    if RULE_LINE_RE.fullmatch(last_line):
        return last_nl + 1
    return offset


def find_insertion_point(text):
    """Return (offset, description) in `text` (post cluster-removal) where
    the new Exercises section should be inserted."""
    sections = find_sections(text)
    for candidate in INSERTION_CANDIDATES:
        for s in sections:
            if s['is_star']:
                continue
            if s['title'] == candidate or s['title'].startswith(candidate):
                offset = s['start']
                offset = _absorb_preceding_rule(text, offset)
                return offset, r'\section{%s}' % candidate
    m = re.search(r'\\pdprintsolutions\b', text)
    if m:
        return _absorb_preceding_rule(text, m.start()), r'\pdprintsolutions'
    m = re.search(r'\\end\{document\}', text)
    if m:
        return _absorb_preceding_rule(text, m.start()), r'\end{document}'
    raise RelocateError("no insertion point found (no \\end{document}?)")


def insert_section(text, offset, section_text):
    before = text[:offset].rstrip('\n \t')
    after = text[offset:]
    return before + '\n\n' + section_text + '\n\n' + after


def already_relocated(text):
    m = re.search(r'\\section\{Exercises\}', text)
    if not m:
        return False
    tail = text[m.end():]
    next_lines = tail.split('\n')[:6]
    for ln in next_lines:
        if r'\pdexercisesfor' in ln:
            return True
    return False


def transform(text, prefix_arg):
    if already_relocated(text):
        return None

    clusters = find_clusters(text)
    if not clusters:
        raise RelocateError("no pdexercise/pdsolution clusters found")

    groups, _sections = group_clusters_by_section(text, clusters)
    prefix = prefix_arg or detect_prefix(clusters)
    if not prefix:
        raise RelocateError("could not detect --prefix from exercise labels")
    rule_line = detect_rule_line(text)

    annotate_cluster_text(text, clusters)
    # Snapshot cluster texts before the source text is mutated by removal.
    exercises_section = build_exercises_section(groups, prefix, rule_line)

    new_body = remove_clusters(text, clusters)
    offset, anchor_desc = find_insertion_point(new_body)
    final_text = insert_section(new_body, offset, exercises_section)

    return {
        'text': final_text,
        'groups': groups,
        'clusters': clusters,
        'prefix': prefix,
        'anchor_desc': anchor_desc,
        'exercises_section': exercises_section,
    }


def run_check(original_text, output_text):
    problems = []

    orig_pdex = len(PDEX_LABEL_RE.findall(original_text))
    out_pdex = len(PDEX_LABEL_RE.findall(output_text))
    if orig_pdex != out_pdex:
        problems.append(
            "pdexercise count changed: %d -> %d" % (orig_pdex, out_pdex)
        )

    orig_pdsol = len(PDSOL_LABEL_RE.findall(original_text))
    out_pdsol = len(PDSOL_LABEL_RE.findall(output_text))
    if orig_pdsol != out_pdsol:
        problems.append(
            "pdsolution count changed: %d -> %d" % (orig_pdsol, out_pdsol)
        )

    orig_labels = PDEX_LABEL_RE.findall(original_text)
    out_labels = PDEX_LABEL_RE.findall(output_text)
    if orig_labels != out_labels:
        problems.append("exercise label sequence changed")

    for lbl in orig_labels:
        n_ex = len(re.findall(re.escape('\\begin{pdexercise}') + r'(?:\[[^\]]*\])?\{' + re.escape(lbl) + r'\}', output_text))
        if n_ex != 1:
            problems.append("label %s appears %d times as pdexercise in output" % (lbl, n_ex))
        n_sol = len(re.findall(re.escape(r'\begin{pdsolution}{' + lbl + '}'), output_text))
        if n_sol != 1:
            problems.append("label %s appears %d times as pdsolution in output" % (lbl, n_sol))

    orig_pairs = {m.group(1): m.group(0) for m in PAIR_RE.finditer(original_text)}
    out_pairs = {m.group(1): m.group(0) for m in PAIR_RE.finditer(output_text)}
    for lbl, orig_block in orig_pairs.items():
        out_block = out_pairs.get(lbl)
        if out_block is None:
            problems.append("moved block for %s not found in output" % lbl)
        elif out_block != orig_block:
            problems.append("moved block for %s is not byte-identical" % lbl)

    return problems


def print_dry_run(original_text, result):
    print("Clusters found per section (body order):")
    for g in result['groups']:
        sizes = [len(c['labels']) for c in g['clusters']]
        print("  %-28s %-40s clusters=%s exercises=%d" % (
            g['section_label'], g['section_title'][:40], sizes, sum(sizes)
        ))
    total_clusters = sum(len(g['clusters']) for g in result['groups'])
    total_exercises = sum(len(c['labels']) for c in result['clusters'])
    print("Total: %d sections, %d clusters, %d exercises" % (
        len(result['groups']), total_clusters, total_exercises
    ))
    print("Detected prefix: %s" % result['prefix'])
    print("Insertion anchor: before %s" % result['anchor_desc'])
    m = re.search(re.escape(result['anchor_desc']), original_text)
    if m:
        line_no = original_text.count('\n', 0, m.start()) + 1
        print("  (original file line ~%d)" % line_no)
    print("First 3 lines of new section:")
    for ln in result['exercises_section'].split('\n')[:3]:
        print("  " + ln)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=(
            "Relocate inline pdexercise/pdsolution clusters in a Harbor "
            "Research chapter into one chapter-end Exercises section, "
            "leaving pointer lines behind."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument('chapter', help="path to the chapter .tex file")
    parser.add_argument(
        '--prefix', default=None,
        help=(
            "label prefix for the new section's own label "
            "(sec:PREFIX-exercises). Default: the most common token between "
            "'ex:' and the first '-' among the chapter's exercise labels."
        ),
    )
    parser.add_argument(
        '--dry-run', action='store_true',
        help="print a summary; write nothing.",
    )
    parser.add_argument(
        '--check', action='store_true',
        help=(
            "explicit flag for the verification pass. The verification "
            "itself always runs after any real write, with or without this "
            "flag; passing it makes the intent explicit."
        ),
    )
    args = parser.parse_args(argv)

    try:
        with open(args.chapter, 'r', encoding='utf-8') as f:
            original_text = f.read()
    except OSError as e:
        print("error: cannot read %s: %s" % (args.chapter, e), file=sys.stderr)
        return 2

    try:
        result = transform(original_text, args.prefix)
    except RelocateError as e:
        print("error: %s" % e, file=sys.stderr)
        return 2

    if result is None:
        print("already relocated")
        return 0

    if args.dry_run:
        print_dry_run(original_text, result)
        return 0

    output_text = result['text']
    with open(args.chapter, 'w', encoding='utf-8') as f:
        f.write(output_text)

    problems = run_check(original_text, output_text)
    if problems:
        with open(args.chapter, 'w', encoding='utf-8') as f:
            f.write(original_text)
        print("check FAILED; original file restored:", file=sys.stderr)
        for p in problems:
            print("  - %s" % p, file=sys.stderr)
        return 1

    total_clusters = sum(len(g['clusters']) for g in result['groups'])
    total_exercises = sum(len(c['labels']) for c in result['clusters'])
    print(
        "relocated %d exercises in %d clusters across %d sections "
        "(prefix=%s); check passed" % (
            total_exercises, total_clusters, len(result['groups']), result['prefix']
        )
    )
    return 0


if __name__ == '__main__':
    sys.exit(main())
