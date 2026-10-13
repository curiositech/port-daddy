"""Consent design and recorded-terminal composition; not runtime evidence."""
import hashlib
import os
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIG = ROOT / 'whitepaper/figures/legible-swarm-consent-lifecycle.tex'
WEB = ROOT / 'website-v2/public/whitepaper'
GUARDS = {
    'scope': r'$x$ in scope',
    'stakes': r'$\mathrm{stakes}(x)\le s_{\max}$',
    'reversibility': r'$\mathrm{reversibility}(x)\ge v_{\min}$',
    'unexpired': r'$g$ unexpired',
    'unrevoked': r'$g$ unrevoked',
}
RECORDS = [
    ('whitepaper/figures/session-swk-lock-demo.tex', 'lstlisting.1.2', 'd55f61ed0ee474be81c6f253a7dd738027f559aa48c53ad34d4bb6906b6d3b5f'),
    ('whitepaper/figures/session-swk-workunit-check.tex', 'lstlisting.1.4', '9cc95cf084c02d7415e67097e9e2a156720c97e3bed9fd5f139afb123a9509d3'),
    ('website-v2/public/whitepaper/figures/session-anchor-v6-attack.tex', 'lstlisting.2.appendix.13', '09ec7ca7dd387a8cea0328342ede788ce4d991218389919c04095b4276a45e23'),
    ('website-v2/public/whitepaper/figures/session-bc-delta30.tex', 'lstlisting.7.1', 'cc19261fc732c24f9bd80da70b2ce001775a84674dd84d5317180b930ffb5b02'),
    ('website-v2/public/whitepaper/figures/session-fh-rollback.tex', 'lstlisting.8.1', 'bd837108cbdebb30afc4ff9332b87a6d6023bb6b4be2b8b3d3195831d03a5be2'),
]


def compact(text):
    return re.sub(r'\s+', '', text).replace('−', '-').replace('‐', '-').replace('‑', '-')


def consent_contract(text):
    clean = '\n'.join(line.split('%', 1)[0] for line in text.splitlines())
    nodes = {name: (float(x), float(y), body.strip()) for name, x, y, body in re.findall(
        r'\\node\[[^]]+\]\s*\(([^)]+)\)\s*at\s*\(([-.\d]+),([-.\d]+)\)\s*\{(.*?)\};', clean, re.S)}
    for name, body in GUARDS.items():
        assert name in nodes and nodes[name][2] == body, name
        x, y, _ = nodes[name]
        assert 30 < x < 191 and 110 < y < 248, 'guard outside per-action gate'
    for token in ('For every action $x$, check current $g$', 'All five must hold (AND)',
                  'no automatic act', 'Next candidate: recheck, never renew',
                  'If $x$ is taken under $g$, record its witness:',
                  r'$(g,\,x,\,\text{reason},\,\text{artifact-link})$',
                  r'$g$ removed\\from active set', r'\textbf{Vision.}',
                  r'\SGMeasuredFigure{I/fig:consent-lifecycle}'):
        assert token in clean, token
    flows = re.findall(r'\\draw\[cl flow[^]]*\]\s*(.*?);', clean)
    assert flows == ['(47,26)--(94,26)', '(182,26)--(241,26)',
                     '(191,148)--(240,148)', '(191,215)--(240,215)',
                     '(30,270)--(10,270)--(10,89)--(22,89)']
    assert clean.count(r'\caption{') == 1
    assert clean.count(r'\label{fig:consent-lifecycle}') == 1
    for token in (r'\resizebox', r'\scalebox', r'\fontsize', r'\tiny', r'\scriptsize', 'transform shape'):
        assert token not in clean


def mono_lines(page):
    return [''.join(s['text'] for s in line['spans'] if 'SourceCodePro' in s['font'])
            for b in page.get_text('dict')['blocks'] for line in b.get('lines', [])
            if any('SourceCodePro' in s['font'] for s in line['spans'])]


def wrap_contract(page):
    lines = [compact(s) for s in mono_lines(page)]
    assert any('skills/harbor-results/scripts/c0_workunit.py' in s for s in lines)
    assert sum(s.count('ext_op(k1)') for s in lines) == 2
    assert sum(s.count('settle(p2!)') for s in lines) == 1
    assert not any(s in (')', '!)', 'py', '.py') for s in lines)


def heading_contract(page):
    raw = page.get_text('rawdict')
    bold = [s for b in raw['blocks'] for line in b.get('lines', []) for s in line['spans']
            if 'SuisseIntl-Semibold' in s['font']]
    text = lambda s: ''.join(c['c'] for c in s['chars'])
    heads = [s for s in bold if 'Model-Checked' in compact(text(s))]
    assert len(heads) == 1
    y = heads[0]['bbox'][1]
    heading = [s for s in bold if y - 1 <= s['bbox'][1] <= y + 30]
    assert any('Soundness' in text(s) for s in heading), 'split heading word'
    assert 'Model-CheckedProperty2.D.2(AttenuationSoundness,Mechanized).' in compact(''.join(map(text, heading)))
    spaces = [c['bbox'][2] - c['bbox'][0] for s in heading for c in s['chars'] if c['c'] == ' ']
    assert spaces and max(spaces) < 5, 'stretched heading spaces'


def zoom_plate_flow(doc, labels, aux):
    """The opening reaches its plate without a stranded paragraph-tail leaf."""
    start = doc.resolve_names()[labels['ls:sec:zoom'][3]]['page']
    folio = re.search(r'\\pdreflectionrecord\{the-unseen-boat\}\{([^}]+)\}', aux).group(1)
    plate = [p.number for p in doc if p.get_label() == folio]
    assert plate == [start + 1], 'paragraph tail occupies a separate leaf before plate'
    assert 'forest dies.' in doc[start].get_text(), 'opening conclusion detached'
    return start, plate[0]


class ConsentTerminalSources(unittest.TestCase):
    def test_consent_source(self):
        consent_contract(FIG.read_text())

    def test_guard_omission_and_false_paths_rejected(self):
        source = FIG.read_text()
        mutants = [source.replace(body, 'condition omitted') for body in GUARDS.values()]
        for a, b in [('(42,210)', '(115,32)'), ('no automatic act', 'execute automatically'),
                     ('--(22,89)', '--(173,26)'), ('If $x$ is taken under $g$', 'If $x$ is admitted'),
                     (r'\text{artifact-link}', r'\text{summary}'), (r'\textbf{Vision.}', r'\textbf{Built.}')]:
            mutants.append(source.replace(a, b))
        mutants.extend([source + r'\draw[cl flow] (250,215)--(250,310);', source + r'\scalebox{.8}{x}'])
        for mutant in mutants:
            with self.assertRaises(AssertionError):
                consent_contract(mutant)

    def test_owning_protocol_and_description(self):
        source = (ROOT / 'whitepaper/legible-swarm.tex').read_text()
        section = source[source.index(r'\subsection{Consent as'):source.index(r'\ifpdmargincolumn\pdconsentregion')]
        for phrase in ('unexpired and unrevoked; otherwise it escalates',
                       'Every action taken under $g$ records', 'all five conditions apply to every admission',
                       "decision renews $g$; expiry or revocation removes it"):
            self.assertIn(phrase, section)
        self.assertNotIn('three-clause guard', section)
        self.assertNotIn('loop back to active', section)
        status = [line for line in source.splitlines() if 'Consent grant + inalienable override &' in line]
        self.assertEqual(len(status), 1)
        self.assertIn(r'\Vision', status[0])

    def test_recorded_bytes_and_opt_in_scope(self):
        count = 0
        for name, _, digest in RECORDS:
            data = (ROOT / name).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), digest)
            body = data.decode().split(r'\begin{pdsession}', 1)[1].split('\n', 1)[1].split(r'\end{pdsession}', 1)[0]
            count += sum(bool(line.strip()) for line in body.splitlines())
        self.assertEqual(count, 97)
        a = (ROOT / 'whitepaper/figures/pd-pedagogy.tex').read_text()
        self.assertEqual(a, (WEB / 'figures/pd-pedagogy.tex').read_text())
        self.assertIn(r'\newif\ifpdsessionwordwrap', a)
        self.assertIn(r'\ifpdsessionwordwrap\lstset{breakatwhitespace=true}\fi', a)
        self.assertIn('breakatwhitespace=false', a)
        self.assertIn(r'\fontsize{8.6}{10.6}', a)
        swk = (ROOT / 'whitepaper/single-writer-kernel.tex').read_text()
        self.assertEqual(swk.count(r'\pdsessionwordwraptrue'), 1)
        self.assertIn('\\begingroup\n\\pdsessionwordwraptrue\n\\input{figures/session-swk-workunit-check}\n\\endgroup', swk)

    def test_heading_alignment_is_local(self):
        source = (WEB / 'anchor-protocol-whitepaper.tex').read_text()
        self.assertIn('\\label{thm:attn-sound}\n\\raggedright\nIn ', source)

    def test_scott_opening_preserves_citation_order_and_defined_term(self):
        source = (ROOT / 'whitepaper/legible-swarm.tex').read_text()
        opening = source[source.index('A referee that only prevents'):
                         source.index(r'\ifdefined\pdreflectionplate\pdreflectionplate{the-unseen-boat}')]
        self.assertEqual(re.findall(r'\\pdcite\{([^}]+)\}', opening),
                         ['scott1998', 'scott1998', 'rao2010'])
        for token in (r'\textbf{m\^etis}', 'hands-on', 'case-specific',
                      'Normalbaum', 'diff, test output, error and reasoning'):
            self.assertIn(token, opening)
        for squeeze in (r'\vspace', r'\small', r'\fontsize', r'\enlargethispage'):
            self.assertNotIn(squeeze, opening)


@unittest.skipUnless(os.environ.get('BOOK_CONSENT_PDF'), 'assembled Book not supplied')
class ConsentTerminalPages(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import fitz
        sys.path.insert(0, str(ROOT / 'scripts/harbor-research'))
        from check_book_label_migration import parse
        cls.path = Path(os.environ['BOOK_CONSENT_PDF'])
        cls.doc = fitz.open(cls.path)
        cls.labels = parse(cls.path.with_suffix('.aux').read_bytes())
        cls.names = cls.doc.resolve_names()

    @classmethod
    def tearDownClass(cls):
        cls.doc.close()

    def test_consent_native_type_and_guards(self):
        from page_overflow import column
        i = self.names[self.labels['ls:fig:consent-lifecycle'][3]]['page']
        page = self.doc[i]
        left, right, _ = column(page, i + 1)
        spans = [s for b in page.get_text('dict')['blocks'] for line in b.get('lines', []) for s in line['spans']]
        for name in ('Operator', 'all five', 'otherwise', 'Admit', 'Escalate', 'no automatic act'):
            found = [s for s in spans if s['text'] == name]
            self.assertEqual(len(found), 1, name)
            s = found[0]
            self.assertIn('SuisseIntl', s['font'])
            self.assertTrue(8.6 <= s['size'] <= 8.9)
            self.assertTrue(left - 1 <= s['bbox'][0] < s['bbox'][2] <= right + 1)
        log = self.path.with_suffix('.log').read_text()
        geometry = re.findall(r'SG-GEOMETRY: I/fig:consent-lifecycle,width=([.\d]+)pt,height=([.\d]+)pt', log)
        self.assertEqual(len(geometry), 1)
        width, height = map(float, geometry[0])
        self.assertLessEqual(width, 325.21503)
        self.assertTrue(340 < height < 350)

    def test_workunit_wrap_and_heading(self):
        wrap_contract(self.doc[self.names['lstlisting.1.4']['page']])
        heading_contract(self.doc[self.names[self.labels['anchor:thm:attn-sound'][3]]['page']])

    def test_opening_and_reflection_plate_have_no_stranded_tail(self):
        zoom_plate_flow(self.doc, self.labels, self.path.with_suffix('.aux').read_text())

    def test_rejected_integration_is_a_rendered_flow_negative_control(self):
        import fitz
        from check_book_label_migration import parse
        before = ROOT / '.cache/book-consent-terminals-20260920/rejected-stranded-paragraph.pdf'
        aux = before.with_suffix('.aux').read_text()
        with fitz.open(before) as doc:
            with self.assertRaisesRegex(AssertionError, 'paragraph tail'):
                zoom_plate_flow(doc, parse(aux.encode()), aux)

    def test_prior_book_is_a_real_negative_control(self):
        import fitz
        from check_book_label_migration import parse
        before = ROOT / '.cache/book-completion-verifier-20260920/coordination-papers-mega-volume.pdf'
        labels = parse(before.with_suffix('.aux').read_bytes())
        with fitz.open(before) as doc:
            names = doc.resolve_names()
            with self.assertRaises(AssertionError):
                wrap_contract(doc[names['lstlisting.1.4']['page']])
            with self.assertRaises(AssertionError):
                heading_contract(doc[names[labels['anchor:thm:attn-sound'][3]]['page']])

    def test_all_five_transcripts_survive_in_order_at_native_size(self):
        for path, destination, _ in RECORDS:
            source = (ROOT / path).read_text()
            body = source.split(r'\begin{pdsession}', 1)[1].split('\n', 1)[1].split(r'\end{pdsession}', 1)[0]
            start = self.names[destination]['page']
            pages = list(self.doc)[start:start+3]
            runs = []
            for p in pages:
                for b in p.get_text('dict')['blocks']:
                    for line in b.get('lines', []):
                        for s in line['spans']:
                            if 'SourceCodePro' in s['font']:
                                runs.append((compact(s['text']), s['size']))
            actual = ''.join(text for text, _ in runs)
            expected = compact(body)
            self.assertEqual(actual.count(expected), 1, path)
            start = actual.index(expected)
            end = start + len(expected)
            offset = 0
            for text, size in runs:
                # Nearby code listings and inline code have different roles;
                # only glyphs inside this exact recorded transcript are checked.
                if offset < end and offset + len(text) > start:
                    self.assertAlmostEqual(size, 9.60316, places=4)
                offset += len(text)


if __name__ == '__main__':
    unittest.main()
