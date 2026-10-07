#!/usr/bin/env python3
"""Adapt the humanizer's generated report for a completed Book edit pass.

Keep its before/after findings, but make dispositions and narrow-screen layout
explicit. This is report rendering, not automatic classification of prose.
"""
import argparse
import json
import re
from pathlib import Path


def prepare(source, findings, output):
    edits = json.loads(findings.read_text())
    content = source.read_text()
    content = content.replace('line-item fix plan', 'editorial changes and structural check')
    content = re.sub(r'<p class="summary">.*?</p>',
        f'<p class="summary"><strong>{len(edits)} completed editorial edits.</strong> '
        'The deleted text is the previous wording; the green block is now in the source. '
        'Line numbers locate that replacement. Style judgments do not establish AI authorship. '
        'The one remaining structural warning, a run of four one-line paragraphs, was '
        'reviewed as a TeX-structure false positive; no prose rewrite is required for it. '
        'This targeted review is not a certification of every page.</p>',
        content, count=1, flags=re.S)
    css = '''
    /* Source paths and category names must wrap rather than widen the page. */
    table { table-layout: fixed; }
    th, .sev, .dialect, .kicker, footer { font-size: 14px; }
    th, td, .kicker { overflow-wrap: anywhere; }
    td.loc, td.ism { white-space: normal; }
    th:nth-child(1) { width: 3%; }
    th:nth-child(2) { width: 7%; }
    th:nth-child(3) { width: 15%; }
    th:nth-child(4) { width: 20%; }
    del, ins { overflow-wrap: anywhere; }
    @media (max-width: 760px) {
      body { padding: 1.2rem 4vw; }
      h1 { font-size: 1.6rem; overflow-wrap: anywhere; }
      table, tbody, tr, td { display: block; width: auto; }
      thead { display: none; }
      tr { border-bottom: 2px solid var(--rule); padding: .5rem 0; }
      td { border: 0; padding: .3rem .7rem; }
      td.num::before { content: 'Entry '; }
      td.loc::before { content: 'Source: '; }
    }
    '''
    content = content.replace('</style>', css+'\n</style>', 1)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(content)
    print(output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('findings', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    prepare(args.source, args.findings, args.output)
