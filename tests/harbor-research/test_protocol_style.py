#!/usr/bin/env python3
"""Focused protocol-only source and optional open-font render checks.

Default: stdlib-only unittest suite; no model imports, network, or TeX execution.
--render: compile just the portable fixture, inspect fresh aux/log/PDF, and
write evidence beneath --output. Never builds or overwrites the published Book.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
PUB = Path("website-v2/public/whitepaper")
PREAMBLE = PUB / "coordination-papers-mega-volume-preamble.tex"
HELPER_SHA = "a34ac91f4a56cf54694e0677a4f57e143ea09a65a300de0d64875f21bb0452a8"
ICONS = ("book-open", "calculator", "file-text", "flask-conical", "key-round",
         "list-checks", "lock-keyhole", "scroll-text", "workflow")
LABELS = {
    "before": ("1.1", "theorem"), "ls": ("1.1", "lsprotocol"),
    "stp": ("1.1", "stpprotocol"), "stp-none": ("1.2", "stpprotocol"),
    "stp-empty": ("1.3", "stpprotocol"), "generic": ("1.1", "protocol"),
    "he": ("1.1", "heprotocol"), "after": ("1.2", "theorem"),
    "definition": ("1.1", "definition"), "long": ("2.1", "lsprotocol"),
    "generic-reset": ("2.1", "protocol"), "he-reset": ("2.1", "heprotocol"),
    "stp-reset": ("2.1", "stpprotocol"), "restored": ("2.1", "theorem"),
    "list-generic": ("3.1", "protocol"), "list-generic-none": ("3.2", "protocol"),
    "list-he": ("3.1", "heprotocol"), "list-he-none": ("3.2", "heprotocol"),
    "list-ls": ("3.1", "lsprotocol"), "list-ls-empty": ("3.2", "lsprotocol"),
    "list-stp": ("3.1", "stpprotocol"), "list-stp-empty": ("3.2", "stpprotocol"),
    "list-restored": ("3.1", "theorem"),
}
BODY_STARTS = {
    "ls": "Required-title protocol body.", "stp": "Optional-title body.",
    "stp-none": "Omitted title", "stp-empty": "Explicitly empty",
    "generic": "The generic amsthm", "he": "The second amsthm",
    "long": "LONG-START.", "generic-reset": "Counter reset",
    "he-reset": "Independent reset", "stp-reset": "Custom counter reset.",
}
LIST_STARTS = {
    "list-generic": ("P1.", "GenericListNamed"),
    "list-generic-none": ("P2.", "GenericListBare"),
    "list-he": ("H1.", "EconomicListNamed"),
    "list-he-none": ("H2.", "EconomicListBare"),
    "list-ls": ("L1.", "RequiredListNamed"),
    "list-ls-empty": ("L2.", "RequiredListEmpty"),
    "list-stp": ("S1.", "OptionalListNamed"),
    "list-stp-empty": ("S2.", "OptionalListEmpty"),
}


def protocol_contract(source: str) -> None:
    """Reject counter replacement, indivisible wrappers, and heading-group leaks."""
    assert r"\usepackage[skins,breakable]{tcolorbox}" in source
    assert r"\input{figures/pd-semantic-blocks}" in source
    assert source.count(r"\theoremstyle{pdprotocol}") == 2
    style = source.split(r"\newtheoremstyle{pdprotocol}", 1)[1].split(
        r"\theoremstyle{definition}", 1)[0]
    assert r"{\normalfont}{}{\bfseries}{.}{0pt}" in style
    assert r"\par\nobreak\smallskip\@afterindentfalse\@afterheading\ignorespaces" in style
    local = style.split(r"\newcommand{\pdprotocolparagraphs}{%", 1)[1].split(
        r"\AtBeginEnvironment{protocol}", 1)[0]
    patch = r"\apptocmd{\@begintheorem}{\leavevmode\pdprotocolheadingend"
    assert patch in local and source.count(patch) == 1
    assert r"\let\pdprotocolsavedentry\@begintheorem" in local
    assert r"\let\@begintheorem\pdprotocolsavedentry" in local
    assert r"\let\pdprotocolsavedhead\thmhead" in local
    assert r"\let\thmhead\pdprotocolsavedhead\ignorespaces" in local
    assert r"\PackageError{pdprotocol}" in local
    assert r"\global" not in local and r"\gdef" not in local
    for name in ("protocol", "heprotocol"):
        assert rf"\AtBeginEnvironment{{{name}}}{{\pdprotocolparagraphs}}" in style
    assert source.count(r"\pdprotocolparagraphs") == 3  # definition and two local hooks
    for name in ("protocol", "heprotocol"):
        assert rf"\newtheorem{{{name}}}{{Protocol}}[section]" in source
        assert rf"\BeforeBeginEnvironment{{{name}}}{{\pdblockbefore{{Protocol}}}}" in source
        assert rf"\AfterEndEnvironment{{{name}}}{{\pdblockafter{{Protocol}}}}" in source
    adorned = re.findall(r"\\BeforeBeginEnvironment\{([^}]+)\}\{\\pdblockbefore", source)
    assert set(adorned) == {"protocol", "heprotocol"}
    for name in ("lsprotocol", "stpprotocol"):
        assert rf"\newcounter{{{name}}}[section]" in source
        assert rf"\begin{{pdbookprotocol}}{{{name}}}{{#1}}" in source
    assert r"\newenvironment{lsprotocol}[1]" in source
    assert r"\newenvironment{stpprotocol}[1][]" in source
    block = source.split(r"\newenvironment{pdbookprotocol}[2]", 1)[1].split(
        r"\newenvironment{lsprotocol}", 1)[0]
    assert block.index(r"\pdblockbefore{Protocol}") < block.index(r"\refstepcounter{#1}")
    assert r"\noindent{\raggedright\normalfont\bfseries" in block
    assert r"\ifblank{#2}{}{\hspace{.35em}(#2)}.\par}" in block
    assert r"\pdblockafter{Protocol}" in block
    assert r"\small\pdprotocolheadingend" in block
    assert "minipage" not in block and "tikzpicture" not in block


def pdf_words(bbox: str) -> list:
    """Read Poppler word boxes in page/line order without inferring from source."""
    pages = []
    for page in ET.fromstring(bbox).findall(".//{*}page"):
        lines = sorted(page.findall(".//{*}line"),
                       key=lambda line: (float(line.attrib["yMin"]), float(line.attrib["xMin"])))
        pages.append([word for line in lines for word in line.findall("{*}word")])
    return pages


def heading_layout(bbox: str, records: dict, starts: dict = BODY_STARTS) -> dict:
    """The first body word must lie below every wrapped heading line."""
    pages = pdf_words(bbox)
    result = {}
    for key, prefix in starts.items():
        tokens = prefix.split()
        matches = [(page_no, i) for page_no, words in enumerate(pages, 1)
                   for i in range(len(words) - len(tokens) + 1)
                   if [word.text for word in words[i:i + len(tokens)]] == tokens]
        assert len(matches) == 1, (key, "missing or ambiguous body", matches)
        page_no, body_index = matches[0]
        assert page_no == records[key]["page"], (key, "heading/body page mismatch")
        words = pages[page_no - 1]
        heads = [i for i in range(body_index - 1)
                 if words[i].text == "Protocol"
                 and (words[i + 1].text or "").rstrip(".") == records[key]["number"]]
        assert heads, (key, "no preceding protocol heading")
        heading = words[heads[-1]:body_index]
        bottom = max(float(word.attrib["yMax"]) for word in heading)
        top = float(words[body_index].attrib["yMin"])
        assert top > bottom, (key, "run-in or overlapping heading/body", bottom, top)
        result[key] = {"page": page_no, "heading": " ".join(word.text or "" for word in heading),
                       "body_prefix": prefix, "heading_bottom_pt": bottom, "body_top_pt": top}
    return result


def list_heading_layout(bbox: str, records: dict, starts: dict = LIST_STARTS) -> dict:
    """Check the actual marker, not just body text: newline can strand a marker."""
    pages, result = pdf_words(bbox), {}
    for key, (marker, body) in starts.items():
        found = {}
        for token in (marker, body):
            matches = [(p, i) for p, words in enumerate(pages, 1)
                       for i, word in enumerate(words) if word.text == token]
            assert len(matches) == 1, (key, token, "missing or ambiguous", matches)
            found[token] = matches[0]
        page_no, body_index = found[body]
        assert page_no == found[marker][0] == records[key]["page"], (key, "page mismatch")
        words = pages[page_no - 1]
        heads = [i for i in range(body_index - 1) if words[i].text == "Protocol"
                 and (words[i + 1].text or "").rstrip(".") == records[key]["number"]]
        assert heads, (key, "no preceding heading")
        heading = [word for word in words[heads[-1]:body_index] if word.text != marker]
        bottom = max(float(word.attrib["yMax"]) for word in heading)
        mark, first = words[found[marker][1]], words[body_index]
        marker_top, body_top = float(mark.attrib["yMin"]), float(first.attrib["yMin"])
        assert min(marker_top, body_top) > bottom, (key, "marker/body not below heading", bottom, marker_top, body_top)
        assert abs(marker_top - body_top) < 0.5, (key, "marker detached from first body line")
        assert float(mark.attrib["xMax"]) < float(first.attrib["xMin"]), (key, "marker not left of body")
        result[key] = {"page": page_no, "marker": marker, "body": body,
                       "heading": " ".join(word.text or "" for word in heading),
                       "heading_bottom_pt": bottom, "marker_top_pt": marker_top,
                       "body_top_pt": body_top}
    return result


def ordinary_heading_layout(bbox: str) -> dict:
    """Unrelated theorem/proof bodies must still share their heading's line."""
    result = {}
    for head, body in (("Theorem", "OrdinarySentinel"), ("Proof.", "ProofSentinel"),
                       ("Remark", "NestedSentinel")):
        matches = [(p, words, i) for p, words in enumerate(pdf_words(bbox), 1)
                   for i, word in enumerate(words) if word.text == body]
        assert len(matches) == 1, body
        page, words, i = matches[0]
        previous = [word for word in words[:i] if word.text == head]
        assert previous, (head, body)
        head_top, body_top = float(previous[-1].attrib["yMin"]), float(words[i].attrib["yMin"])
        assert abs(head_top - body_top) < 0.5, (head, "unrelated heading changed", head_top, body_top)
        result[body] = {"page": page, "heading_top_pt": head_top, "body_top_pt": body_top}
    return result


class ProtocolSourceTests(unittest.TestCase):
    def test_exact_source_and_repository_dependency_manifest(self):
        manifest_path = ROOT / "docs/harbor-research/exposition/PROTOCOL-CHECKPOINT-20260920.json"
        manifest = json.loads(manifest_path.read_text())
        self.assertEqual(manifest["base_commit"], "73d8ce4ec38d1f1125d32401888984a7f5ee1936")
        ancestry = subprocess.run(
            ["git", "merge-base", "--is-ancestor", manifest["base_commit"], "HEAD"],
            cwd=ROOT, text=True, capture_output=True, check=False)
        self.assertEqual(ancestry.returncode, 0, ancestry.stderr)
        for group in ("source_files", "fixture_repository_inputs"):
            for entry in manifest[group]:
                with self.subTest(path=entry["path"]):
                    actual = hashlib.sha256((ROOT / entry["path"]).read_bytes()).hexdigest()
                    self.assertEqual(actual, entry["sha256"])

    def test_protocol_contract(self):
        protocol_contract((ROOT / PREAMBLE).read_text())

    def test_negative_controls_reject_heading_and_counter_regressions(self):
        source = (ROOT / PREAMBLE).read_text()
        for old, new in (
            (r".\par}", r".}\par"),
            (r"\newcounter{lsprotocol}[section]", r"\newcounter{lsprotocol}"),
            (r"\raggedright\normalfont", r"\normalfont"),
            (r"{\bfseries}{.}{0pt}", r"{\bfseries}{.}{\newline}"),
            (r"\leavevmode\pdprotocolheadingend", r"\ignorespaces"),
            (r"\small\pdprotocolheadingend", r"\nobreak\smallskip\small"),
            (r"\AtBeginEnvironment{protocol}{\pdprotocolparagraphs}", r"\pdprotocolparagraphs"),
            (r"\let\@begintheorem\pdprotocolsavedentry", r"\relax"),
            (r"\let\thmhead\pdprotocolsavedhead\ignorespaces", r"\ignorespaces"),
            (r"\newenvironment{stpprotocol}[1][]", r"\newenvironment{stpprotocol}[1]"),
        ):
            with self.subTest(regression=old):
                self.assertIn(old, source)
                with self.assertRaises((AssertionError, ValueError, IndexError)):
                    protocol_contract(source.replace(old, new))

    def test_pdf_geometry_rejects_runin_and_wrapped_heading_regressions(self):
        def specimen(body_top):
            return f'''<doc><page>
              <line xMin="10" yMin="10"><word yMax="20">Protocol</word>
                <word yMax="20">1.1</word><word yMax="20">(Long</word></line>
              <line xMin="10" yMin="22"><word yMax="32">title).</word></line>
              <line xMin="10" yMin="{body_top}"><word yMin="{body_top}">Body.</word></line>
            </page></doc>'''
        record = {"generic": {"page": 1, "number": "1.1"}}
        self.assertEqual(heading_layout(specimen(35), record, {"generic": "Body."})[
            "generic"]["heading"], "Protocol 1.1 (Long title).")
        for body_top in (22, 31, 32):
            with self.subTest(body_top=body_top), self.assertRaises(AssertionError):
                heading_layout(specimen(body_top), record, {"generic": "Body."})

    def test_frozen_helper_and_mirror(self):
        data = (ROOT / PUB / "figures/pd-semantic-blocks.tex").read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), HELPER_SHA)
        self.assertEqual(data, (ROOT / "whitepaper/figures/pd-semantic-blocks.tex").read_bytes())
        text = data.decode()
        self.assertNotIn(r"\newcounter", text)
        self.assertEqual(set(re.findall(r"\\def\\pdblock@icon\{([^}]+)\}", text)), set(ICONS))
        for segment in ("unbroken", "first", "middle", "last"):
            self.assertIn("overlay " + segment + r"={\pdblock@frame}", text)

    def test_list_geometry_rejects_marker_stranded_on_heading_line(self):
        def specimen(marker_top):
            return f'''<doc><page>
              <line xMin="10" yMin="10"><word yMin="10" yMax="20">Protocol</word>
                <word yMax="20">3.1.</word></line>
              <line xMin="10" yMin="{marker_top}"><word yMin="{marker_top}" xMax="20">P1.</word></line>
              <line xMin="30" yMin="30"><word yMin="30" xMin="30">Body</word></line>
            </page></doc>'''
        records = {"list-generic": {"page": 1, "number": "3.1"}}
        starts = {"list-generic": ("P1.", "Body")}
        self.assertEqual(list_heading_layout(specimen(30), records, starts)[
            "list-generic"]["marker_top_pt"], 30)
        for marker_top in (10, 20, 25):
            with self.subTest(marker_top=marker_top), self.assertRaises(AssertionError):
                list_heading_layout(specimen(marker_top), records, starts)

    def test_every_helper_asset_is_present_and_mirrored(self):
        for name in ICONS:
            for extension in ("svg", "pdf"):
                rel = Path("figures/lucide") / f"{name}.{extension}"
                public = (ROOT / PUB / rel).read_bytes()
                self.assertEqual(public, (ROOT / "whitepaper" / rel).read_bytes())
                self.assertTrue(public.startswith(b"%PDF-") if extension == "pdf"
                                else b"<svg" in public)
        for name in ("LICENSE", "LICENSE.lucide.txt", "LICENSE.feather.txt"):
            rel = Path("figures/lucide") / name
            self.assertEqual((ROOT / PUB / rel).read_bytes(),
                             (ROOT / "whitepaper" / rel).read_bytes())
        license_text = (ROOT / PUB / "figures/lucide/LICENSE").read_text()
        self.assertIn("ISC License", license_text)
        self.assertIn("The MIT License", license_text)

    def test_ordinary_theorem_styles_stay_unadorned(self):
        source = (ROOT / PREAMBLE).read_text()
        self.assertIn("\\theoremstyle{definition}\n\\newtheorem{definition}", source)
        self.assertIn("\\theoremstyle{plain}\n\\newtheorem{theorem}", source)
        self.assertIn("\\theoremstyle{remark}\n\\newtheorem*{remark}", source)
        self.assertIn("\\theoremstyle{pdprotocol}\n\\newtheorem{heprotocol}", source)
        self.assertRegex(source, r"\\AfterEndEnvironment\{heprotocol\}.*\n\\theoremstyle\{definition\}")

    def test_fixture_has_no_machine_or_private_font_dependency(self):
        for name in ("protocol-style-book.tex", "protocol-style-fixture.tex"):
            source = (ROOT / "tests/harbor-research/fixtures" / name).read_text()
            self.assertNotIn("/Users/", source)
            self.assertNotIn("/System/Library/", source)
            self.assertNotIn("Suisse", source)
        wrapper = (ROOT / "tests/harbor-research/fixtures/protocol-style-book.tex").read_text()
        self.assertIn(r"\providecommand{\pdprotocolroot}", wrapper)
        self.assertIn("main-open", wrapper)

    def test_mirror_pdfs_are_not_ignored(self):
        paths = [f"whitepaper/figures/lucide/{name}.pdf" for name in ICONS]
        result = subprocess.run(["git", "check-ignore", *paths], cwd=ROOT,
                                text=True, capture_output=True, check=False)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)


def render(root: Path, output: Path, engine: str, profile: str) -> None:
    """Compile fresh isolated fixture output and check counters, refs, and scope.

    Existing output is refused, preventing stale aux/PDF evidence. Only open
    TeX-distribution fonts are selectable. Tectonic is offline/cache-only.
    """
    root, output = root.resolve(), output.resolve()
    if output.exists():
        raise SystemExit(f"Refusing existing output directory: {output}")
    if output == Path("/tmp") or output.is_relative_to(Path("/private/tmp")) or output.is_relative_to(Path("/tmp")):
        raise SystemExit("Choose a persistent output directory, not /tmp.")
    if re.search(r"[{}%#\\\n]", str(root)):
        raise SystemExit("TeX root path contains unsupported metacharacters.")
    for tool in (engine, "pdftotext", "pdffonts", "pdfinfo"):
        if not shutil.which(tool):
            raise SystemExit(f"Required tool missing: {tool}")
    # Resolve immutable source identities once before the proof, never from a
    # moving origin/main during or after compilation.
    manifest = json.loads((root / "docs/harbor-research/exposition/PROTOCOL-CHECKPOINT-20260920.json").read_text())
    base_commit = manifest["base_commit"]
    source_head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    subprocess.run(["git", "merge-base", "--is-ancestor", base_commit, source_head],
                   cwd=root, check=True)
    input_hashes = {entry["path"]: hashlib.sha256((root / entry["path"]).read_bytes()).hexdigest()
                    for entry in manifest["fixture_repository_inputs"]}
    runner_sha = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    output.mkdir(parents=True)
    driver = output / "protocol-style.tex"
    driver.write_text(
        "\\def\\pdprotocolroot{" + root.as_posix() + "}\n"
        "\\def\\pdprotocolfontprofile{" + profile + "}\n"
        "\\input{" + (root / "tests/harbor-research/fixtures/protocol-style-book.tex").as_posix() + "}\n"
    )
    if engine == "tectonic":
        command = [engine, "--only-cached", "--untrusted", "--keep-logs",
                   "--keep-intermediates", "--reruns", "2", "--outdir", str(output),
                   "--makefile-rules", str(output / "inputs.mk"), str(driver)]
        runs = 1
    else:
        command = [engine, "-no-shell-escape", "-halt-on-error",
                   "-interaction=nonstopmode", "-recorder", "-output-directory",
                   str(output), str(driver)]
        runs = 3
    for attempt in range(runs):
        result = subprocess.run(command, cwd=root, text=True, capture_output=True, timeout=180)
        (output / f"engine-{attempt + 1}.txt").write_text(result.stdout + result.stderr)
        if result.returncode:
            raise SystemExit(f"{engine} failed; see {output}/engine-{attempt + 1}.txt")
    for path, expected in input_hashes.items():
        assert hashlib.sha256((root / path).read_bytes()).hexdigest() == expected, (path, "input changed during proof")
    assert hashlib.sha256(Path(__file__).read_bytes()).hexdigest() == runner_sha, "validator changed during proof"
    log = driver.with_suffix(".log").read_text()
    for pattern in (r"undefined references", r"Reference .* undefined", r"multiply defined",
                    r"Overfull \\[hv]box", r"! LaTeX Error", r"Missing character:"):
        if re.search(pattern, log, re.I):
            raise AssertionError(f"Fixture log failed: {pattern}")
    assert log.count("PROTOCOL SCOPE RESTORED") >= 17
    assert log.count("PROTOCOL BODY PARAGRAPH") == 18
    assert "PROTOCOL GLYPH COUNT: 18" in log
    assert f"PROTOCOL FONT PROFILE: {profile}" in log
    aux = driver.with_suffix(".aux").read_text()
    records = {}
    for key, (number, kind) in LABELS.items():
        match = re.search(r"\\newlabel\{fixture:" + re.escape(key) + r"\}\{\{([^}]+)\}\{([^}]+)\}\{.*?\}\{([^}]+)\}", aux)
        assert match, f"Missing label {key}"
        assert match[1] == number, (key, match[1], number)
        assert match[3] == f"{kind}.{number}", (key, match[3])
        records[key] = {"number": match[1], "page": int(match[2]), "anchor": match[3]}
    end = re.search(r"\\newlabel\{fixture:long-end\}\{\{[^}]+\}\{(\d+)\}", aux)
    assert end and int(end[1]) - records["long"]["page"] >= 2, "No middle split segment"
    pdf = driver.with_suffix(".pdf")
    text = subprocess.check_output(["pdftotext", "-layout", str(pdf), "-"], text=True)
    fonts = subprocess.check_output(["pdffonts", str(pdf)], text=True)
    destinations = subprocess.check_output(["pdfinfo", "-dests", str(pdf)], text=True)
    bbox = subprocess.check_output(["pdftotext", "-bbox-layout", str(pdf), "-"], text=True)
    headings = heading_layout(bbox, records)
    lists = list_heading_layout(bbox, records)
    ordinary = ordinary_heading_layout(bbox)
    pdf_anchors = {name: int(page) for page, name in re.findall(
        r'^\s*(\d+)\s+\[.*?\]\s+"([^"]+)"', destinations, re.M)}
    for record in records.values():
        assert pdf_anchors.get(record["anchor"]) == record["page"], record
    assert "??" not in text
    assert "LONG-START" in text and "LONG-END" in text and "RESTORATION" in text
    assert "Suisse" not in fonts and "Menlo" not in fonts
    assert ("TeXGyreHeros" if profile == "heros-open" else "TeXGyrePagella") in fonts
    assert not re.search(r"Protocol\s+\d+\.\d+\s*\(\s*\)", text)
    (output / "text.txt").write_text(text)
    (output / "fonts.txt").write_text(fonts)
    (output / "destinations.txt").write_text(destinations)
    (output / "heading-layout.json").write_text(json.dumps(headings, indent=2) + "\n")
    (output / "list-layout.json").write_text(json.dumps(lists, indent=2) + "\n")
    (output / "ordinary-layout.json").write_text(json.dumps(ordinary, indent=2) + "\n")
    receipt = {"scope": "protocol-only open-font fixture; not full-Book acceptance",
               "base_commit": base_commit, "source_head": source_head,
               "fixture_repository_inputs_sha256": input_hashes,
               "validation_script_sha256": runner_sha,
               "engine": engine, "profile": profile, "command": command,
               "pdf_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
               "labels": records, "standalone_protocol_headings": len(headings),
               "list_first_headings": len(lists), "ordinary_inline_controls": len(ordinary)}
    receipt["paragraph_entry_checks"] = log.count("PROTOCOL BODY PARAGRAPH")
    receipt["protocol_glyph_count"] = 18
    receipt["scope_restoration_checks"] = log.count("PROTOCOL SCOPE RESTORED")
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    if "--render" in sys.argv:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument("--render", action="store_true")
        parser.add_argument("--root", type=Path, default=ROOT)
        parser.add_argument("--output", type=Path, required=True)
        parser.add_argument("--engine", choices=("tectonic", "xelatex"), default="tectonic")
        parser.add_argument("--font-profile", choices=("main-open", "heros-open"), default="main-open")
        args = parser.parse_args()
        render(args.root, args.output, args.engine, args.font_profile)
    else:
        unittest.main()
