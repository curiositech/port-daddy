"""Shared semantic apparatus and optional full-build counter regression."""
import os
from pathlib import Path
import re
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]


class SemanticBlocks(unittest.TestCase):
    def test_mirrors_and_counter_separation(self):
        relative = "figures/pd-semantic-blocks.tex"
        a = (ROOT / "whitepaper" / relative).read_text()
        b = (ROOT / "website-v2/public/whitepaper" / relative).read_text()
        self.assertEqual(a, b)
        for forbidden in (r"\newcounter", r"\refstepcounter", r"\marginpar"):
            self.assertNotIn(forbidden, a)
        self.assertIn(r"\let\pgfsys@typesetpicturebox\pd@typesetpicturebox", a)
        self.assertIn(r"\ifdefstring{\pdblock@family}", a)
        self.assertIn(r"{Conjecture}{\def\pdblock@family{Empirical hypothesis}}", a)

    def test_closed_claim_vocabulary_is_unchanged(self):
        source = (ROOT / "whitepaper/figures/pd-pedagogy.tex").read_text()
        self.assertIn(r"\newcommand{\pd@claim@kinds}{Theorem,Design invariant,Model-checked property,Empirical hypothesis}", source)
        self.assertIn(r"\input{figures/pd-semantic-blocks}", source)
        self.assertIn(r"\newcommand{\pd@numberedhead}[3][theorem]", source)
        self.assertIn(r"\refstepcounter{#1}", source)
        self.assertIn(r"\postdisplaypenalty=10000\relax", source)
        self.assertNotIn(r"\pdblockglyph{Numbers by hand}\pd@marginglyph", source)

    def test_lucide_assets_and_complete_split_frames(self):
        directory = ROOT / "website-v2/public/whitepaper/figures"
        source = (directory / "pd-semantic-blocks.tex").read_text()
        self.assertNotIn(r"\newcommand{\pdblockrule}", source)
        self.assertNotIn(r"\begin{tikzpicture}", source)
        self.assertIn("rectangle (frame.north east)", source)
        self.assertIn("enhanced,breakable", source)
        for segment in ("unbroken", "first", "middle", "last"):
            self.assertIn("overlay " + segment + r"={\pdblock@frame}", source)
        icons = set(re.findall(r"\\def\\pdblock@icon\{([^}]+)\}", source))
        self.assertEqual(len(icons), 9)
        self.assertIn("workflow", icons)
        self.assertIn("Lucide", (directory / "lucide/LICENSE").read_text())
        for icon in icons:
            for extension in ("svg", "pdf"):
                asset = (directory / "lucide" / (icon + "." + extension)).read_bytes()
                mirror = (ROOT / "whitepaper/figures/lucide" / (icon + "." + extension)).read_bytes()
                self.assertEqual(asset, mirror)
                self.assertTrue(asset)
            self.assertTrue((directory / "lucide" / (icon + ".pdf")).read_bytes().startswith(b"%PDF-1.5"))

    def test_claims_and_calculations_share_bold_numbered_heading(self):
        source = (ROOT / "whitepaper/figures/pd-pedagogy.tex").read_text()
        mirror = (ROOT / "website-v2/public/whitepaper/figures/pd-pedagogy.tex").read_text()
        self.assertEqual(source, mirror)
        for display in ("Model-Checked Property", "Empirical Hypothesis",
                        "Design Invariant", "Numbers by Hand"):
            self.assertIn(display, source)
        self.assertIn(r"\pd@numberedhead{\pdkind{#1}}{#2}", source)
        self.assertIn(r"\pd@numberedhead[pdworkedexample]{Numbers by Hand}{#1}", source)
        self.assertIn(r"\let\c@pdworkedexample\c@theorem", source)
        self.assertIn(r"\pdworkedexampleautorefname", source)
        self.assertIn(r"\ifstrempty{#3}{}{\hspace{.35em}(#3)}.", source)
        self.assertNotIn(r"\itshape Numbers by hand ---", source)

    def test_protocol_family_uses_official_workflow_and_distinct_ink(self):
        source = (ROOT / "whitepaper/figures/pd-semantic-blocks.tex").read_text()
        self.assertIn(r"\definecolor{pdblockProtocol}{HTML}{007D73}", source)
        self.assertIn(r"{Protocol}{\def\pdblock@color{pdblockProtocol}\def\pdblock@icon{workflow}}", source)
        colors = dict(re.findall(r"\\definecolor\{([^}]+)\}\{HTML\}\{([^}]+)\}", source))
        self.assertNotIn(colors["pdblockProtocol"],
                         [value for key, value in colors.items() if key != "pdblockProtocol"])
        vendor = (ROOT / "scripts/harbor-research/vendor_lucide_book_icons.sh").read_text()
        self.assertIn(" workflow;", vendor)

    def test_approved_palette_uses_quiet_fields_and_full_strength_edges(self):
        source = (ROOT / "whitepaper/figures/pd-semantic-blocks.tex").read_text()
        colors = dict(re.findall(r"\\definecolor\{pdblock([^}]+)\}\{HTML\}\{([^}]+)\}", source))
        approved = dict(Proof="B33F35", Property="7048A5", Hypothesis="427A26",
                        Calculation="946000", Invariant="233A76", Definition="3D454B",
                        Checked="006EA0", Protocol="007D73", Neutral="363B40")
        self.assertEqual(colors, approved)
        self.assertIn(r"draw=\pdblock@color,line width=.5pt", source)
        self.assertIn(r"colback=\pdblock@color!6!white", source)
        self.assertNotIn(r"\pdblock@color!65!white", source)
        self.assertIn("left=11pt,right=11pt,top=10pt,bottom=10pt", source)
        for family in ("Proof", "Checked", "Hypothesis", "Invariant", "Calculation", "Protocol"):
            self.assertIn(r"\ifdefstring{\pdblock@color}{pdblock" + family + "}", source)
        # Accent belongs to the field and edge, never a blanket body-text style.
        self.assertNotIn(r"\color{\pdblock@color}", source)
        self.assertNotIn(r"\itshape", source)

    def test_body_and_edge_contrast_on_actual_six_percent_fields(self):
        source = (ROOT / "whitepaper/figures/pd-semantic-blocks.tex").read_text()
        colors = re.findall(r"\\definecolor\{pdblock[^}]+\}\{HTML\}\{([^}]+)\}", source)
        rgb = lambda h: [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
        def luminance(v):
            linear = [c / 12.92 if c <= .04045 else ((c + .055) / 1.055)**2.4 for c in v]
            return sum(c*w for c, w in zip(linear, (.2126, .7152, .0722)))
        def ratio(a, b):
            x, y = sorted((luminance(a), luminance(b)))
            return (y+.05)/(x+.05)
        self.assertAlmostEqual(ratio(rgb("000000"), rgb("FFFFFF")), 21)
        self.assertLess(ratio(rgb("777777"), rgb("FFFFFF")), 4.5)
        for color in colors:
            accent = rgb(color)
            field = [.06*c + .94 for c in accent]
            with self.subTest(color=color):
                self.assertGreaterEqual(ratio(accent, field), 3)
                for ink in ("1B1712", "121212"):
                    self.assertGreaterEqual(ratio(rgb(ink), field), 7)

    def test_all_book_protocol_forms_share_frame_without_counter_replacement(self):
        source = (ROOT / "website-v2/public/whitepaper/coordination-papers-mega-volume-preamble.tex").read_text()
        for name in ("protocol", "heprotocol"):
            self.assertIn(r"\BeforeBeginEnvironment{" + name + r"}{\pdblockbefore{Protocol}}", source)
            self.assertIn(r"\AfterEndEnvironment{" + name + r"}{\pdblockafter{Protocol}}", source)
            self.assertIn(r"\newtheorem{" + name + r"}{Protocol}[section]", source)
        for name in ("lsprotocol", "stpprotocol"):
            self.assertIn(r"\begin{pdbookprotocol}{" + name + "}{#1}", source)
            self.assertIn(r"\newcounter{" + name + "}[section]", source)
        helper = source.split(r"\newenvironment{pdbookprotocol}[2]", 1)[1].split(
            r"\newenvironment{lsprotocol}", 1)[0]
        self.assertIn(r"\refstepcounter{#1}", helper)
        self.assertIn(r"\normalfont\bfseries\color{hhink}\pdblockglyph{Protocol}", helper)
        self.assertIn(r"\noindent{\raggedright\normalfont", helper)
        self.assertIn(r"\hspace{.35em}(#2)}.\par}", helper)
        self.assertIn(r"\ifblank{#2}{}{\hspace{.35em}(#2)}.", helper)
        self.assertIn(r"\pdblockbefore{Protocol}", helper)
        self.assertIn(r"\pdblockafter{Protocol}", helper)
        self.assertNotIn("mdframed", helper)
        self.assertNotIn("minipage", helper)

    @unittest.skipUnless(os.environ.get("BOOK_BLOCK_FIXTURE_PDF"),
                         "rendered heading fixture not supplied")
    def test_requested_headings_are_bold_and_references_resolve(self):
        import fitz
        pdf = Path(os.environ["BOOK_BLOCK_FIXTURE_PDF"])
        heads = {
            "lab:checked": ("1.2", "Model-Checked Property 1.2 (Finite Scope)."),
            "lab:hyp": ("1.3", "Empirical Hypothesis 1.3 (Recovery Rate)."),
            "lab:inv": ("1.4", "Design Invariant 1.4 (Monotone Revisions)."),
            "lab:arithmetic": ("1.5", "Numbers by Hand 1.5 (Exact Arithmetic)."),
        }
        aux = pdf.with_suffix(".aux").read_text()
        self.assertIn("{pdworkedexample.1.5}", aux)
        self.assertIn(r"\newlabel{lab:longexample}{{2.2}", aux)
        self.assertIn(r"\newlabel{lab:ordinary-long}{{2.3}", aux)
        with fitz.open(pdf) as document:
            text = " ".join(" ".join(page.get_text().split()) for page in document)
            self.assertIn("Named reference: Numbers by Hand 1.5", text)
            self.assertIn("Automatic reference: Numbers by Hand 1.5", text)
            for label, (number, heading) in heads.items():
                self.assertIn(r"\newlabel{" + label + "}{{" + number + "}", aux)
                matches = []
                for page in document:
                    for block in page.get_text("dict")["blocks"]:
                        if "lines" not in block:
                            continue
                        bold = " ".join(span["text"] for line in block["lines"]
                                        for span in line["spans"]
                                        if "Semibold" in span["font"] or "Bold" in span["font"])
                        if heading in " ".join(bold.replace("\u2011", "-").split()):
                            matches.append(page.number)
                self.assertEqual(len(matches), 1, heading)

    def test_citation_capacity_break_survives_generation(self):
        generated = ROOT / ".cache/whitepaper-build/coordination-papers-mega-volume/mega-volume-body.tex"
        if not generated.exists():
            self.skipTest("run Book generator first")
        self.assertRegex(generated.read_text(),
                         r"\\pagebreak\[4\]\s+Nor is the pattern new in normative conflict")
        # Reserve body space for the long VRF first-use source. Do not defer
        # the source independently or weaken the measured margin-capacity gate.
        self.assertRegex(generated.read_text(),
                         r"\\Needspace\{14\\baselineskip\}\s+Second, the system injects")
        spawn = (ROOT / "website-v2/public/whitepaper/spawn-to-person.tex").read_text()
        self.assertIn("where the two mechanisms arrest it.\n\n``Who audits", spawn)
        self.assertIn("to answer, reached from the other side.\n\nAnd applied", spawn)
        vrf = spawn.index("Second, the system injects")
        diagram = spawn.index(r"\input{figures/fig-stp-rate-the-raters}")
        bound = spawn.index("Let $G_k$ bound the judge's total one-shot gain")
        self.assertLess(vrf, diagram)
        self.assertLess(diagram, bound)

    def test_shared_heads_end_before_the_body(self):
        root = ROOT / "website-v2/public/whitepaper"
        pedagogy = (root / "figures/pd-pedagogy.tex").read_text()
        helper = pedagogy.split(r"\newcommand{\pd@numberedhead}", 1)[1].split(
            r"\newenvironment{pdclaim}", 1)[0]
        self.assertIn(r".\par}", helper)
        self.assertIn(r"\pdblockheadingend", helper)
        self.assertNotIn(r"\enspace\ignorespaces", helper)
        preamble = (root / "coordination-papers-mega-volume-preamble.tex").read_text()
        self.assertEqual(preamble.count(r"{.}{0pt}{\pdblockglyph"), 3)
        self.assertIn(r"\patchcmd{\@begintheorem}{\ignorespaces}{\leavevmode\pdblockheadingend}", preamble)
        self.assertIn(r"\patchcmd\csname\string\proof\endcsname", preamble)
        self.assertIn(r"{\ignorespaces}{\leavevmode\pdblockheadingend}", preamble)
        for environment in ("pdexercise", "pdSolution"):
            body = pedagogy.split(r"\newenvironment{" + environment + "}", 1)[1].split("}{%", 1)[0]
            self.assertIn(r"\pdblockheadingend", body)
        self.assertIn(r"{\bfseries #1}\pdblockheadingend{\itshape #2}", pedagogy)

    @unittest.skipUnless(os.environ.get("BOOK_WORKED_PDF"), "actual Book proof not supplied")
    def test_audit_rate_substitution_stays_with_its_interpretation(self):
        import fitz
        with fitz.open(os.environ["BOOK_WORKED_PDF"]) as document:
            pages = [" ".join(page.get_text().replace("\u2019", "'").split()) for page in document]
            owners = [text for text in pages if "At the program's running parameters" in text]
            self.assertEqual(len(owners), 1)
            self.assertIn("0.25", owners[0])
            self.assertIn("audit one grade in four", owners[0].lower())
            self.assertIn("20%", owners[0])

    @unittest.skipUnless(os.environ.get("BOOK_WORKED_PDF"), "actual Book proof not supplied")
    def test_actual_wrapped_property_heading_has_normal_word_spaces(self):
        import fitz
        with fitz.open(os.environ["BOOK_WORKED_PDF"]) as document:
            page = document[document.resolve_names()["property.5.6.1"]["page"]]
            # Justification can cause PDF extraction to split one visual line
            # into many spans with no space glyph. Measure word geometry.
            words = page.get_text("words")
            starts = [word for word in words if word[4] == "Property"]
            self.assertEqual(len(starts), 1)
            start = starts[0]
            frames = [d["rect"] for d in page.get_drawings()
                      if d["type"] == "s" and 250 < d["rect"].width < 400
                      and d["rect"].contains(fitz.Rect(start[:4]))]
            self.assertEqual(len(frames), 1)
            frame = frames[0]
            ends = [word for word in words if word[4] == "Liability)."
                    and frame.contains(fitz.Rect(word[:4]))]
            self.assertEqual(len(ends), 1)
            heading = [word for word in words if frame.contains(fitz.Rect(word[:4]))
                       and start[1] - 1 <= word[1] <= ends[0][1] + 1]
            self.assertIn("5.6.1", [word[4] for word in heading])
            rows = []
            for word in sorted(heading, key=lambda w: (w[1], w[0])):
                if not rows or abs(rows[-1][0][1] - word[1]) > 1:
                    rows.append([])
                rows[-1].append(word)
            gaps = [right[0] - left[2] for row in rows
                    for left, right in zip(sorted(row), sorted(row)[1:])]
            self.assertTrue(gaps)
            self.assertLess(max(gaps), 5, "Actual Property heading uses justified word spacing")

    @unittest.skipUnless(os.environ.get("BOOK_HEADING_PARAGRAPH_PDF"),
                         "new-paragraph heading fixture not supplied")
    def test_rendered_body_begins_below_complete_heading(self):
        import fitz
        pairs = [
            ("Definition 1.1 (Bounded counter).", "A bounded counter is an integer"),
            ("Property 1.1 (Range).", "The set in Definition"),
            ("Theorem 1.1 (Upper bound).", "For a bounded counter,"),
            ("Proof.", "Add one to both sides"),
            ("Model-Checked Property 1.2 (Finite Scope).", "The four-state model"),
            ("Empirical Hypothesis 1.3 (Recovery Rate).", "A visible receipt may"),
            ("Design Invariant 1.4 (Monotone Revisions).", "The design requires"),
            ("Numbers by Hand 1.5 (Exact Arithmetic).", "Seventeen groups of six"),
            ("Definition 3.1.", "Unnamed definition body"),
            ("statement).", "Wrapped theorem body"),
            ("Liability).", "Wrapped property body"),
            ("Design Invariant 3.2.", "Unnamed claim body"),
            ("the body).", "Wrapped calculation body"),
            ("Protocol 3.1 (Admission).", "Protocol body starts"),
            ("Protocol 3.1 (Consent).", "Consent protocol body"),
            ("Protocol 3.1 (Delegation).", "Delegation protocol body"),
            ("Protocol 3.1 (Settlement).", "Settlement protocol body"),
            ("Remark (Scope).", "Remark body starts"),
            ("Mara, 3:25 p.m.", "Scene body starts"),
            ("0.1", "Exercise body starts"),
            ("0.1", "Solution body starts"),
            ("A statement beginning with a list).", "List body starts"),
            ("A statement beginning with a display).", "Display body continues"),
        ]
        def normalize(value):
            return " ".join(value.replace("\u2011", "-").replace("\u2010", "-").split())
        with fitz.open(os.environ["BOOK_HEADING_PARAGRAPH_PDF"]) as book:
            # Normalize extraction only, never move or manufacture PDF text.
            pages = [[{"text": normalize("".join(s["text"] for s in line["spans"])),
                       "box": line["bbox"]}
                      for block in page.get_text("dict")["blocks"] if "lines" in block
                      for line in block["lines"]] for page in book]
            for heading, opening in pairs:
                with self.subTest(heading=heading, opening=opening):
                    owners = [(i, line) for i, lines in enumerate(pages)
                              for line in lines if opening in line["text"]]
                    self.assertEqual(len(owners), 1, opening)
                    page, body = owners[0]
                    # A wrapped heading is allowed; its last named line must
                    # still end above the body on the same physical page.
                    heads = [line for line in pages[page] if heading in line["text"]
                             and line["box"][1] <= body["box"][1]]
                    self.assertTrue(heads, heading)
                    head = max(heads, key=lambda line: line["box"][1])
                    self.assertGreater(body["box"][1], head["box"][3] + 0.5,
                                       "Body shares or overlaps the heading paragraph")
                    if opening == "Wrapped property body":
                        raw = book[page].get_text("rawdict")
                        lines = [line for block in raw["blocks"]
                                 for line in block.get("lines", [])]
                        starts = [line["bbox"][1] for line in lines
                                  if "Property 3.1" in "".join(c["c"] for s in line["spans"] for c in s["chars"])]
                        self.assertEqual(len(starts), 1)
                        spaces = [c["bbox"][2] - c["bbox"][0]
                                  for line in lines if starts[0] <= line["bbox"][1] < body["box"][1]
                                  for span in line["spans"] for c in span["chars"] if c["c"] == " "]
                        self.assertTrue(spaces)
                        self.assertLess(max(spaces), 4.5, "Wrapped heading stretches interword spaces")
                    if opening == "List body starts":
                        markers = [line for line in pages[page]
                                   if (line["text"] == "1." or line["text"].startswith("1. List body"))
                                   and abs(line["box"][1] - body["box"][1]) < 1]
                        self.assertEqual(len(markers), 1,
                                         "List marker must accompany its item below the heading")

    @unittest.skipUnless(os.environ.get("BOOK_BLOCK_BEFORE_AUX") and
                         os.environ.get("BOOK_BLOCK_AFTER_AUX"), "full-build auxiliaries not supplied")
    def test_public_labels_preserve_numbers(self):
        expected = os.environ.get("BOOK_BLOCK_EXPECTED_RENUMBERING")
        if expected:
            import json
            report = json.loads(Path(expected).read_text())
            checker = ("check_book_label_migration.py" if "baseline_aux_sha256" in report
                       else "check_book_reference_numbering.py")
            command = [sys.executable, str(ROOT / "scripts/harbor-research" / checker),
                       "--before-aux", os.environ["BOOK_BLOCK_BEFORE_AUX"],
                       "--after-aux", os.environ["BOOK_BLOCK_AFTER_AUX"],
                       "--expected-report", expected]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return
        def numbers(path):
            return dict(re.findall(r"\\newlabel\{([^}]+)\}\{\{([^}]*)\}", Path(path).read_text()))
        before = numbers(os.environ["BOOK_BLOCK_BEFORE_AUX"])
        after = numbers(os.environ["BOOK_BLOCK_AFTER_AUX"])
        public = {key: value for key, value in before.items()
                  if re.search(r"(?:^|:)(?:thm|def|prop|lem|cor|ex|fig|tab):", key)
                  and not key.endswith("@cref")}
        self.assertGreater(len(public), 100)
        differences = {key: (value, after.get(key)) for key, value in public.items()
                       if after.get(key) != value}
        self.assertEqual(differences, {})


if __name__ == "__main__":
    unittest.main()
