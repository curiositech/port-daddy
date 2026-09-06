"""P15 (the figure type ladder) and P16 (retiring hh* hues) in tikz_precheck."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "tikz_precheck.py"


def run_on(source, name="fig-x.tex"):
    with tempfile.TemporaryDirectory() as d:
        # a sibling pd-figure-language.tex makes detect_corpus() say "chapter"
        (Path(d) / "pd-figure-language.tex").write_text("% stub\n")
        frag = Path(d) / name
        frag.write_text(source)
        out = Path(d) / "r.json"
        subprocess.run([sys.executable, str(SCRIPT), str(frag), "--json", str(out)],
                       capture_output=True, text=True)
        return json.loads(out.read_text())[0]


def ids(report, rule):
    return [f for f in report["findings"] if f.get("id") == rule]


HEAD = "% provenance: a test fragment\n\\begin{tikzpicture}[pd figure]\n"
TAIL = "\\end{tikzpicture}\n"


class TestTypeLadder(unittest.TestCase):
    def test_clean_fragment_passes(self):
        r = run_on(HEAD + "\\node[pd state] at (0,0) {witnessed};\n"
                   "\\node[pd title] at (0,1) {write targets};\n" + TAIL)
        self.assertEqual(ids(r, "P15"), [])
        self.assertEqual(r["summary"]["result"], "pass")

    def test_font_override_at_point_of_use_fails(self):
        r = run_on(HEAD + "\\node[pd state,font=\\small] at (0,0) {witnessed};\n" + TAIL)
        self.assertTrue(ids(r, "P15"))
        self.assertEqual(r["summary"]["result"], "fail")

    def test_font_inside_a_style_definition_is_allowed(self):
        r = run_on("% provenance\n\\begin{tikzpicture}[pd figure,"
                   "mine/.style={font=\\footnotesize\\scshape,align=center}]\n"
                   "\\node[mine] at (0,0) {two words};\n" + TAIL)
        self.assertEqual(ids(r, "P15"), [])

    def test_bold_and_italic_switches_fail(self):
        for cmd in ("\\textbf{done}", "\\itshape done", "\\textsc{done}",
                    "\\MakeUppercase{done}"):
            with self.subTest(cmd=cmd):
                r = run_on(HEAD + "\\node[pd label] at (0,0) {" + cmd + "};\n" + TAIL)
                self.assertTrue(ids(r, "P15"), cmd)

    def test_all_caps_word_fails(self):
        r = run_on(HEAD + "\\node[pd state] at (0,0) {DONE};\n" + TAIL)
        self.assertTrue(ids(r, "P15"))

    def test_all_caps_inside_texttt_is_allowed(self):
        r = run_on(HEAD + "\\node[pd state] at (0,0) {\\texttt{REFUSED}};\n" + TAIL)
        self.assertEqual(ids(r, "P15"), [])

    def test_short_caps_word_is_allowed(self):
        r = run_on(HEAD + "\\node[pd label] at (0,0) {an ID};\n" + TAIL)
        self.assertEqual(ids(r, "P15"), [])

    def test_caption_prose_is_not_policed(self):
        r = run_on("% provenance\n\\begin{figure}\n" + HEAD + TAIL +
                   "\\caption{The \\textbf{lead} sentence, and an ALLCAPS word.}\n"
                   "\\end{figure}\n")
        self.assertEqual(ids(r, "P15"), [])

    def test_more_than_three_voices_reported_once_more(self):
        body = "".join(
            "\\node[pd label,font=%s] at (%d,0) {x};\n" % (f, i)
            for i, f in enumerate(("\\small", "\\large", "\\Large", "\\huge")))
        r = run_on(HEAD + body + TAIL)
        over = [f for f in ids(r, "P15") if "distinct point-of-use text voices" in f["message"]]
        self.assertEqual(len(over), 1)


class TestRetiredHues(unittest.TestCase):
    def test_retired_hh_colour_warns_but_does_not_fail(self):
        r = run_on(HEAD + "\\draw[draw=hhteal] (0,0) -- (1,0);\n" + TAIL)
        self.assertTrue(ids(r, "P16"))
        self.assertTrue(all(f["severity"] == "warn" for f in ids(r, "P16")))
        self.assertEqual(r["summary"]["hard_count"], 0)

    def test_palette_ink_and_cream_do_not_warn(self):
        r = run_on(HEAD + "\\draw[draw=pdink,fill=pdcreamraised] (0,0) rectangle (1,1);\n" + TAIL)
        self.assertEqual(ids(r, "P16"), [])

    def test_hh_ink_and_paper_now_warn_too(self):
        # hhink/hhpaper still parse so the un-migrated corpus keeps building,
        # but they are on the way out with the rest of the hh* set.
        r = run_on(HEAD + "\\draw[draw=hhink,fill=hhpaper] (0,0) rectangle (1,1);\n" + TAIL)
        self.assertEqual(len(ids(r, "P16")), 2)
        self.assertEqual(r["summary"]["hard_count"], 0)

    def test_palette_hue_is_clean(self):
        r = run_on(HEAD + "\\draw[draw=pdcobalt,fill=pdindigo!20] (0,0) rectangle (1,1);\n" + TAIL)
        self.assertEqual(ids(r, "P16"), [])
        self.assertEqual(r["summary"]["result"], "pass")

    def test_colour_outside_the_palette_is_a_hard_finding(self):
        r = run_on(HEAD + "\\draw[draw=crimson] (0,0) -- (1,0);\n" + TAIL)
        self.assertTrue([f for f in r["findings"] if f["check"] == "color"])
        self.assertEqual(r["summary"]["result"], "fail")


if __name__ == "__main__":
    unittest.main()
