import importlib.util
import json
import subprocess
import tempfile
import unittest
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "render_tikz_figure.py"
EXAMPLE = ROOT / "examples" / "clean-two-lane-sequence.tex"
TEMPLATE = ROOT / "templates" / "publication-figure.tex"
SCRATCH_ROOT = Path.home() / "coding" / "tmp"
spec = importlib.util.spec_from_file_location("renderer", SCRIPT)
renderer = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(renderer)

HAS_ENGINE = any(renderer.which(candidate) for candidate in ("pdflatex", "xelatex", "lualatex"))
HAS_RASTERIZER = bool(renderer.which("pdftocairo") or renderer.which("magick"))
HAS_PDFINFO = bool(renderer.which("pdfinfo"))
HAS_RENDER_SUPPORT = HAS_ENGINE and HAS_RASTERIZER
RENDER_SKIP_REASON = "requires a local LaTeX engine and either pdftocairo or ImageMagick"
FIT_SKIP_REASON = f"{RENDER_SKIP_REASON}; page-fit assertions also require pdfinfo"

class RendererTests(unittest.TestCase):
    def temporary_dir(self):
        SCRATCH_ROOT.mkdir(parents=True, exist_ok=True)
        return tempfile.TemporaryDirectory(dir=SCRATCH_ROOT)

    def test_source_audit_flags_tiny_and_long_edge_label(self):
        source = r"\\tiny \\draw (0,0) -- node{this relation label is far too long for an edge} (1,0);"
        kinds = {item["kind"] for item in renderer.source_warnings(source)}
        self.assertIn("small-text", kinds)
        self.assertIn("long-edge-label", kinds)

    def test_missing_engine_is_explained_without_starting_a_subprocess(self):
        with mock.patch.object(renderer, "which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "No LaTeX engine found"):
                renderer.locate_engine("auto")

    def test_renderer_has_no_undeclared_pdfplumber_import(self):
        self.assertNotIn("pdfplumber", SCRIPT.read_text())

    def test_empty_contact_sheet_is_a_clean_noop(self):
        with self.temporary_dir() as tmp:
            self.assertIsNone(renderer.contact_sheet([], Path(tmp)))

    @unittest.skipUnless(HAS_RENDER_SUPPORT, RENDER_SKIP_REASON)
    def test_example_renders_and_reports_no_strict_warnings(self):
        source = EXAMPLE.read_text()
        self.assertIn("node[above=3mm]{signed transfer}", source)
        self.assertNotIn("\\tiny", source)
        with self.temporary_dir() as tmp:
            out = Path(tmp) / "out"
            result = subprocess.run(["python3", str(SCRIPT), str(EXAMPLE), "--out-dir", str(out), "--preview", "--strict", "--max-width-in", "6.5", "--max-height-in", "4.6"], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
            self.assertEqual(result.returncode, 0, result.stdout)
            report = json.loads((out / "render-report.json").read_text())
            figure = report["figures"][0]
            self.assertTrue(figure["compiled"])
            self.assertTrue(Path(figure["pdf"]).exists())
            self.assertTrue(Path(figure["png"]).exists())
            self.assertEqual(figure["warnings"], [])
            self.assertTrue(report["preview"])
            self.assertEqual(report["dpi"], renderer.PREVIEW_DPI)

    @unittest.skipUnless(HAS_RENDER_SUPPORT and HAS_PDFINFO, FIT_SKIP_REASON)
    def test_template_compiles_with_basic_tex_install_and_page_gate(self):
        with self.temporary_dir() as tmp:
            out = Path(tmp) / "out"
            result = subprocess.run(["python3", str(SCRIPT), str(TEMPLATE), "--out-dir", str(out), "--strict", "--max-width-in", "6.5", "--max-height-in", "4.6"], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
            self.assertEqual(result.returncode, 0, result.stdout)
            report = json.loads((out / "render-report.json").read_text())
            self.assertLessEqual(report["figures"][0]["width_in"], 6.5)

    @unittest.skipUnless(HAS_RENDER_SUPPORT, RENDER_SKIP_REASON)
    def test_relative_output_directory_is_resolved_from_caller(self):
        with self.temporary_dir() as tmp:
            cwd = Path(tmp)
            result = subprocess.run(["python3", str(SCRIPT), str(EXAMPLE), "--out-dir", "relative-build", "--strict"], cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
            self.assertEqual(result.returncode, 0, result.stdout)
            self.assertTrue((cwd / "relative-build" / "render-report.json").exists())

    @unittest.skipUnless(HAS_RENDER_SUPPORT and HAS_PDFINFO, FIT_SKIP_REASON)
    def test_strict_page_limit_rejects_an_oversized_canvas(self):
        with self.temporary_dir() as tmp:
            out = Path(tmp) / "out"
            result = subprocess.run(["python3", str(SCRIPT), str(EXAMPLE), "--out-dir", str(out), "--strict", "--max-width-in", "1.0"], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
            self.assertNotEqual(result.returncode, 0)
            report = json.loads((out / "render-report.json").read_text())
            kinds = {item["kind"] for item in report["figures"][0]["warnings"]}
            self.assertIn("page-width", kinds)

    @unittest.skipUnless(HAS_RENDER_SUPPORT, RENDER_SKIP_REASON)
    def test_invalid_latex_emits_a_failed_report(self):
        with self.temporary_dir() as tmp:
            source = Path(tmp) / "invalid.tex"
            source.write_text(r"\documentclass{article}\begin{document}\definitelyundefinedcommand\end{document}")
            out = Path(tmp) / "out"
            result = subprocess.run(["python3", str(SCRIPT), str(source), "--out-dir", str(out)], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
            self.assertNotEqual(result.returncode, 0, result.stdout)
            report = json.loads((out / "render-report.json").read_text())
            self.assertFalse(report["figures"][0]["compiled"])
            self.assertIn("Undefined control sequence", report["figures"][0]["fatal"])

    @unittest.skipUnless(HAS_RENDER_SUPPORT and bool(renderer.which("magick")),
                         "contact-sheet composition requires ImageMagick in addition to the ordinary renderer prerequisites")
    def test_contact_sheet_is_emitted_for_multiple_figures(self):
        with self.temporary_dir() as tmp:
            source_dir = Path(tmp) / "sources"
            source_dir.mkdir()
            for source in (EXAMPLE, TEMPLATE):
                (source_dir / source.name).write_text(source.read_text())
            out = Path(tmp) / "out"
            result = subprocess.run(["python3", str(SCRIPT), str(source_dir), "--out-dir", str(out), "--contact-sheet", "--strict", "--max-width-in", "6.5", "--max-height-in", "4.6"], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
            self.assertEqual(result.returncode, 0, result.stdout)
            self.assertTrue((out / "contact-sheet.png").exists())
