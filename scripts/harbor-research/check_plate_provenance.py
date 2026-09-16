#!/usr/bin/env python3
"""check_plate_provenance.py -- every rendered Book plate has honest
provenance, and every plate path the TeX sources reach for actually exists.

Two review-bot asks, one module (stdlib only, no Pillow, no LaTeX engine):

  A. PROVENANCE.json completeness/accuracy for each rendered-plate directory
     under website-v2/public/whitepaper/plates/ (everything except
     marginalia/, which has its own licence-sidecar checker,
     check_marginalia_sidecars.py -- this script does not touch it).

  B. Static resolution of every plate path the .tex sources can reach, so a
     renamed or deleted plate fails in seconds here instead of ~20 minutes
     into a pdflatex run raising \\PackageError (see commit c342a85fc, which
     made the Swiss plate macros fail closed instead of drawing TikZ
     fallback art).

-------------------------------------------------------------------------
A. Provenance schema (derived from scripts/whitepaper-plates/plates_pipeline.py
   and from the PROVENANCE.json files actually committed on this branch --
   NOT an aspirational schema; plates_pipeline.py only ever writes cover
   art, so the swiss/ and technical/ files were partly hand-authored /
   recovered from an earlier git round, and the two authoring paths use
   different but overlapping field sets):

   Document level (website-v2/public/whitepaper/plates/<dir>/PROVENANCE.json):
     - "plates": required. A dict keyed by plate name (e.g. "cover",
       "part-I", "chapter-swk", or, for the technical edition, "chapter-1").
     - "model", "post": optional at document level. When present they are
       taken as the model/post-processing note for every entry in the
       document that does not carry its own (this is exactly how
       plates_pipeline.py and the swiss round wrote them: once per file,
       not once per plate).

   Per-entry level (each value in "plates"):
     - "prompt": REQUIRED, non-empty string, always written per entry by
       every round seen on this branch.
     - model provenance: REQUIRED, satisfied by any ONE of:
         entry["model"]              (technical/cover, technical/chapter-3)
         document["model"]           (swiss's document-level model)
         entry["recovered_from"]     (technical's engraving-round entries,
                                      e.g. "175f3e753 (the art-system commit,
                                      engraving round)" -- a reference to
                                      where the original model record lives,
                                      standing in for restating it)
       "prompt (or a prompt reference)" in the task brief is the same idea
       applied to model: an inline value, or a reference to where it lives.
     - post-processing/crop description: REQUIRED, satisfied by any ONE of:
         entry["post"]                (technical/cover, technical/chapter-3)
         document["post"]             (swiss's document-level post note)
         entry["note"]                (technical's engraving-round entries)
     - DERIVED RENDERS are the one exception to the three above. A plate
       that is a render of something this repository already builds -- page
       one of a CI-built edition PDF, for instance -- was made by no image
       model, so it has no prompt, no model and no post-processing round.
       Such an entry declares instead:
         entry["derived_from"]  what it was rendered from
         entry["render"]        how (tool, page, size, encode)
       and those two stand in for "prompt", model provenance and the
       post-processing note. Declaring "derived_from" without "render" is
       itself a failure -- naming a source without saying what was done to
       it is not provenance. Everything else, the aspect-ratio check
       included, applies unchanged.
     - file resolution (see (b) below): the entry must name, or default to,
       a file that exists in the directory.
     - "final_aspect" / "generation_aspect" / "aspect" (checked in that
       preference order, whichever is present first): OPTIONAL. When
       present it must be a "W:H" string, and the referenced image's real
       pixel dimensions (read from the JPEG/PNG header, not decoded) must
       match that ratio within 2%.

   (b) Every *.jpg / *.png plate file in the directory must have a "plates"
   entry (by dict key == file stem); every entry must resolve to a file
   that exists. An entry's own "file" field is used when present (and must
   exist); when absent (technical's cover/chapter-3 entries never recorded
   which image backs them) the entry key plus whatever extension the
   directory actually uses for that stem is assumed -- this is a deliberate
   leniency for data already committed on this branch, not an invitation to
   omit "file" going forward.

   REQUIRED_PROVENANCE_DIRS: a plate directory with no PROVENANCE.json at
   all is only a failure when it is in this set. TODO for whoever adds a
   new plate directory: everything not in this set and not already
   PROVENANCE'd is silently skipped, which is right exactly twice on this
   branch and should not become a third: (1) the top-level plates/ root
   (the maritime/watercolor edition) predates plates_pipeline.py entirely
   and was hand-recovered into its own PROVENANCE.json; if that file is
   ever lost, re-recover it rather than relying on this checker's silence.
   (2) plates/marginalia/ is out of scope for this script by design (its
   own checker owns it). Any *new* rendered-plate directory should be added
   to REQUIRED_PROVENANCE_DIRS, not left to fall through this exemption.

-------------------------------------------------------------------------
B. TeX path resolution.

   Concrete, literal `plates/...` arguments to \\includegraphics or
   \\IfFileExists anywhere in website-v2/public/whitepaper/*.tex or
   whitepaper/*.tex are checked directly.

   The Swiss plate macros (coordination-papers-mega-volume-swiss-plates.tex)
   and the maritime/technical chapter and part openers
   (coordination-papers-mega-volume-preamble.tex) build their paths from a
   TeX parameter (`plates/swiss/chapter-#1.jpg` etc) that is only ever
   filled in at the generated-body stage (scripts/generate-mega-whitepaper.mjs,
   from whitepaper/textbook.json) -- the filled-in call sites are not
   committed .tex, so a literal-text scan alone cannot check them. Instead
   this script extracts each such macro's path *template* straight out of
   its \\newcommand/\\def body (so a template edit is picked up
   automatically) and substitutes every chapter prefix, chapter number, and
   part numeral from whitepaper/textbook.json -- the one source of chapter
   order and prefixes the book generator itself trusts -- to get the
   concrete paths the real build will ask for.

Exit status: 0 if both (A) and (B) are clean, 1 otherwise (each problem
printed as one line, then a summary line).

Usage:
    python3 scripts/harbor-research/check_plate_provenance.py [--repo-root PATH]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import struct
import sys

# ---------------------------------------------------------------------------
# (A) provenance schema

PLATES_SUBDIR = os.path.join("website-v2", "public", "whitepaper", "plates")
IMAGE_EXTS = (".jpg", ".jpeg", ".png")

# See the "TODO" paragraph in the module docstring before adding an
# exemption instead of adding a directory here.
REQUIRED_PROVENANCE_DIRS = {"swiss", "technical"}

ASPECT_FIELDS = ("final_aspect", "generation_aspect", "aspect")
ASPECT_TOLERANCE = 0.02  # 2%


def read_image_size(path: str) -> tuple[int, int]:
    """Return (width, height) parsed from a JPEG or PNG header. stdlib only;
    no image is decoded, just the container's own size fields."""
    with open(path, "rb") as f:
        head = f.read(24)
        if head[:8] == b"\x89PNG\r\n\x1a\n":
            if len(head) < 24:
                raise ValueError(f"{path}: truncated PNG header")
            w, h = struct.unpack(">II", head[16:24])
            return w, h
        if head[:2] == b"\xff\xd8":
            f.seek(2)
            while True:
                marker = f.read(2)
                if len(marker) < 2:
                    raise ValueError(f"{path}: no SOF marker found before EOF")
                if marker[0:1] != b"\xff":
                    # resync byte-by-byte until we find the next 0xFF
                    f.seek(-1, os.SEEK_CUR)
                    continue
                m = marker[1]
                if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
                    continue  # standalone markers, no length/payload
                if m == 0xD9:
                    raise ValueError(f"{path}: reached EOI before an SOF marker")
                seg_len_raw = f.read(2)
                if len(seg_len_raw) < 2:
                    raise ValueError(f"{path}: truncated JPEG segment length")
                seg_len = struct.unpack(">H", seg_len_raw)[0]
                # SOFn markers that carry dimensions (exclude DHT/JPG/DAC).
                if m in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                         0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    payload = f.read(5)
                    if len(payload) < 5:
                        raise ValueError(f"{path}: truncated SOF segment")
                    h, w = struct.unpack(">HH", payload[1:5])
                    return w, h
                f.seek(seg_len - 2, os.SEEK_CUR)
        raise ValueError(f"{path}: not a recognized JPEG or PNG")


def parse_aspect_ratio(spec: str) -> float | None:
    m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$", spec)
    if not m:
        return None
    w, h = float(m.group(1)), float(m.group(2))
    if h == 0:
        return None
    return w / h


def check_provenance_dir(dir_path: str, label: str, required: bool) -> list[str]:
    """Return failure strings for one plate directory (non-recursive: only
    the image files that sit directly inside dir_path)."""
    failures: list[str] = []

    image_paths = sorted(
        p for ext in IMAGE_EXTS
        for p in glob.glob(os.path.join(dir_path, f"*{ext}"))
    )
    if not image_paths:
        return []  # nothing to check for this directory

    prov_path = os.path.join(dir_path, "PROVENANCE.json")
    if not os.path.exists(prov_path):
        if required:
            return [f"{label}: no PROVENANCE.json found at {prov_path}"]
        return []

    with open(prov_path, "r", encoding="utf-8") as f:
        raw = f.read()
    try:
        doc = json.loads(raw)
    except json.JSONDecodeError as e:
        return [f"{label}: {prov_path} is not valid JSON ({e})"]

    if not isinstance(doc, dict):
        return [f"{label}: {prov_path} does not contain a JSON object"]

    plates = doc.get("plates")
    if not isinstance(plates, dict):
        return [f"{label}: {prov_path} has no top-level 'plates' object"]

    # basename (no ext) -> actual filename on disk, e.g. "cover" -> "cover.jpg"
    stem_to_filename = {
        os.path.splitext(os.path.basename(p))[0]: os.path.basename(p)
        for p in image_paths
    }

    # (b1) every image file has an entry
    for stem, filename in stem_to_filename.items():
        if stem not in plates:
            failures.append(
                f"{label}: {filename} has no provenance entry (key '{stem}') in {prov_path}"
            )

    doc_model = doc.get("model")
    doc_post = doc.get("post")

    for key, entry in plates.items():
        if not isinstance(entry, dict):
            failures.append(f"{label}: entry '{key}' in {prov_path} is not an object")
            continue

        # (b2) file resolution: entry['file'] if present, else key+ext of a
        # same-named file already on disk.
        entry_file = entry.get("file")
        if entry_file:
            resolved = os.path.join(dir_path, entry_file)
            if not os.path.exists(resolved):
                failures.append(
                    f"{label}: entry '{key}' names file '{entry_file}' which does not exist "
                    f"(dangling provenance entry)"
                )
                continue
        else:
            filename = stem_to_filename.get(key)
            if filename is None:
                failures.append(
                    f"{label}: entry '{key}' has no 'file' field and no matching "
                    f"image {key}.(jpg|png) exists in {dir_path} (dangling provenance entry)"
                )
                continue
            resolved = os.path.join(dir_path, filename)

        # (c) required per-entry fields (with document-level / reference fallbacks)
        #
        # A plate that is a RENDER of something the repository already builds
        # -- page one of a CI-built edition PDF, say -- has no prompt, no
        # model and no post-processing round, because no image model made it.
        # Demanding those three of it would only invite a fabricated prompt,
        # which is the opposite of what this file is for. Such an entry
        # declares "derived_from" (what it was rendered from) and "render"
        # (how), and those two stand in for the three below. Everything else,
        # the aspect-ratio check included, still applies.
        derived_from = entry.get("derived_from")
        render = entry.get("render")
        is_derived = (
            isinstance(derived_from, str) and derived_from.strip()
            and isinstance(render, str) and render.strip()
        )
        if isinstance(derived_from, str) and derived_from.strip() and not is_derived:
            failures.append(
                f"{label}: entry '{key}' declares 'derived_from' but no non-empty "
                f"'render' saying how it was produced from it"
            )

        if not is_derived:
            prompt = entry.get("prompt")
            if not (isinstance(prompt, str) and prompt.strip()):
                failures.append(f"{label}: entry '{key}' has no non-empty 'prompt'")

            model_ok = any(
                isinstance(v, str) and v.strip()
                for v in (entry.get("model"), doc_model, entry.get("recovered_from"))
            )
            if not model_ok:
                failures.append(
                    f"{label}: entry '{key}' has no model provenance (entry 'model', "
                    f"document-level 'model', or entry 'recovered_from')"
                )

            post_ok = any(
                isinstance(v, str) and v.strip()
                for v in (entry.get("post"), doc_post, entry.get("note"))
            )
            if not post_ok:
                failures.append(
                    f"{label}: entry '{key}' has no post-processing description (entry "
                    f"'post', document-level 'post', or entry 'note')"
                )

        # (d) aspect ratio, if declared
        aspect_field = next((f for f in ASPECT_FIELDS if f in entry), None)
        if aspect_field is not None:
            declared = entry[aspect_field]
            expected_ratio = parse_aspect_ratio(declared) if isinstance(declared, str) else None
            if expected_ratio is None:
                failures.append(
                    f"{label}: entry '{key}' field '{aspect_field}' = {declared!r} is not "
                    f"a 'W:H' aspect ratio"
                )
            else:
                try:
                    w, h = read_image_size(resolved)
                except (ValueError, OSError) as e:
                    failures.append(f"{label}: entry '{key}': {e}")
                else:
                    if w <= 0 or h <= 0:
                        # A header can declare a zero or negative dimension --
                        # read_image_size reports the container's own size
                        # fields and decodes nothing, so a corrupt or forged
                        # header arrives here intact. Report it rather than
                        # dividing by it.
                        failures.append(
                            f"{label}: entry '{key}': {os.path.basename(resolved)} "
                            f"declares a {w}x{h} image, which is not a size an aspect "
                            f"ratio can be taken from"
                        )
                        actual_ratio = None
                        rel_err = None
                    else:
                        actual_ratio = w / h
                        rel_err = abs(actual_ratio - expected_ratio) / expected_ratio
                    if rel_err is not None and rel_err > ASPECT_TOLERANCE:
                        failures.append(
                            f"{label}: entry '{key}' declares {aspect_field}={declared!r} "
                            f"({expected_ratio:.4f}) but {os.path.basename(resolved)} is "
                            f"{w}x{h} ({actual_ratio:.4f}), {rel_err * 100:.1f}% off "
                            f"(tolerance {ASPECT_TOLERANCE * 100:.0f}%)"
                        )

    return failures


def list_plate_units(plates_root: str) -> list[tuple[str, str]]:
    """(label, directory) pairs to check: the plates/ root itself (only its
    own direct files -- this is the maritime/watercolor edition, which sits
    right in plates/, not a subdirectory), then every immediate subdirectory
    except marginalia/ (out of scope; see the module docstring)."""
    units = [("plates (maritime)", plates_root)]
    if os.path.isdir(plates_root):
        for name in sorted(os.listdir(plates_root)):
            sub = os.path.join(plates_root, name)
            if name == "marginalia" or not os.path.isdir(sub):
                continue
            units.append((f"plates/{name}", sub))
    return units


def check_all_provenance(repo_root: str) -> list[str]:
    plates_root = os.path.join(repo_root, PLATES_SUBDIR)
    failures: list[str] = []
    for label, dir_path in list_plate_units(plates_root):
        dir_name = os.path.basename(dir_path.rstrip(os.sep))
        required = dir_name in REQUIRED_PROVENANCE_DIRS
        failures.extend(check_provenance_dir(dir_path, label, required))
    return failures


# ---------------------------------------------------------------------------
# (B) static TeX plate-path resolution

WHITEPAPER_SUBDIR = os.path.join("website-v2", "public", "whitepaper")
TEXTBOOK_JSON = os.path.join("whitepaper", "textbook.json")
TEX_GLOBS = [
    os.path.join("website-v2", "public", "whitepaper", "*.tex"),
    os.path.join("whitepaper", "*.tex"),
]

# Path *templates* to extract, straight out of the named macro's body, in
# the named file. `key_kind` says which textbook.json axis fills the
# template's placeholder(s): every "#<digit>" token in whatever path string
# we find inside the macro body is substituted with that value (there is
# only ever one live placeholder per template on this branch; substituting
# all of them uniformly is simplest and correct here).
#
#   'literal'  -- no placeholder; the extracted path is used as-is.
#   'prefix'   -- one substitution per chapter, using its "prefix".
#   'number'   -- one substitution per chapter, using its "number".
#   'numeral'  -- one substitution per part, using its "numeral".
MACRO_TEMPLATE_SOURCES = [
    ("coordination-papers-mega-volume-swiss-plates.tex", "pdswisscoverart", "literal"),
    ("coordination-papers-mega-volume-swiss-plates.tex", "pdswisspartplate", "numeral"),
    ("coordination-papers-mega-volume-swiss-plates.tex", "pdswissplate", "prefix"),
    ("coordination-papers-mega-volume-preamble.tex", "pd@chapter@maritime", "prefix"),
    ("coordination-papers-mega-volume-preamble.tex", "pd@chapter@technical", "number"),
    ("coordination-papers-mega-volume-preamble.tex", "pd@part@maritime", "numeral"),
    ("coordination-papers-mega-volume-preamble.tex", "pd@part@technical", "numeral"),
]

_INCLUDEGRAPHICS_RE = re.compile(r"\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}")
_IFFILEEXISTS_RE = re.compile(r"\\IfFileExists\{([^}]+)\}")


_TEX_COMMENT_RE = re.compile(r"(?<!\\)%.*$", re.MULTILINE)


def _strip_tex_comments(text: str) -> str:
    """Drop TeX comments (an unescaped % to end of line) before any macro or
    path extraction, so a commented-out \\includegraphics, a stray brace in a
    comment, or a path mentioned in prose after a % can never be read as a
    real reference or unbalance the brace count."""
    return _TEX_COMMENT_RE.sub("", text)


def _find_macro_body(text: str, macro_name: str) -> str | None:
    """Extract the brace-balanced body of \\newcommand{\\NAME}[n]{...} or
    \\def\\NAME#1...#n{...}. Does not handle escaped braces (none of the
    macros this script reads contain any)."""
    escaped = re.escape(macro_name)
    for pattern in (
        r"\\newcommand\{\\" + escaped + r"\}(?:\[\d+\])?\{",
        r"\\def\\" + escaped + r"(?:#\d)*\{",
    ):
        m = re.search(pattern, text)
        if not m:
            continue
        start = m.end()
        depth = 1
        i = start
        while i < len(text) and depth > 0:
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
            i += 1
        if depth != 0:
            return None  # unbalanced; give up rather than mis-extract
        return text[start:i - 1]
    return None


def _extract_plate_path_template(body: str) -> str | None:
    for rx in (_INCLUDEGRAPHICS_RE, _IFFILEEXISTS_RE):
        for m in rx.finditer(body):
            path = m.group(1).strip()
            if path.startswith("plates/"):
                return path
    return None


def load_textbook(repo_root: str) -> dict:
    path = os.path.join(repo_root, TEXTBOOK_JSON)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def resolve_template(template: str, value: str) -> str:
    return re.sub(r"#\d", value, template)


def collect_expected_tex_paths(repo_root: str) -> tuple[list[tuple[str, str]], list[str]]:
    """Return (expected, problems): expected is a list of (relative plate
    path, human label for error messages); problems is a list of
    already-formatted failure strings for templates that could not be
    extracted at all (a macro-body edit outran this script, which is a
    problem in itself, not something to skip silently)."""
    expected: list[tuple[str, str]] = []
    problems: list[str] = []
    seen: set[str] = set()

    def add(path: str, label: str) -> None:
        key = (path, label)
        if key not in seen:
            seen.add(key)
            expected.append((path, label))

    try:
        textbook = load_textbook(repo_root)
    except (OSError, json.JSONDecodeError) as e:
        return [], [f"could not load {TEXTBOOK_JSON}: {e}"]
    chapters = textbook.get("chapters", [])
    parts = textbook.get("parts", [])

    tex_cache: dict[str, str] = {}

    def tex_text(filename: str) -> str | None:
        if filename not in tex_cache:
            path = os.path.join(repo_root, WHITEPAPER_SUBDIR, filename)
            try:
                with open(path, "r", encoding="utf-8") as f:
                    tex_cache[filename] = _strip_tex_comments(f.read())
            except OSError as e:
                tex_cache[filename] = None
                problems.append(f"could not read {path}: {e}")
        return tex_cache[filename]

    for filename, macro_name, key_kind in MACRO_TEMPLATE_SOURCES:
        text = tex_text(filename)
        if text is None:
            continue
        body = _find_macro_body(text, macro_name)
        if body is None:
            problems.append(
                f"could not find macro body for \\{macro_name} in {filename} "
                f"(macro renamed or restructured? update MACRO_TEMPLATE_SOURCES)"
            )
            continue
        template = _extract_plate_path_template(body)
        if template is None:
            problems.append(
                f"macro \\{macro_name} in {filename} has no plates/ path in its body "
                f"(update MACRO_TEMPLATE_SOURCES if this is intentional)"
            )
            continue
        label = f"\\{macro_name} in {filename}"
        if key_kind == "literal":
            add(template, label)
        elif key_kind == "prefix":
            for ch in chapters:
                add(resolve_template(template, ch["prefix"]), f"{label} (chapter {ch['prefix']})")
        elif key_kind == "number":
            for ch in chapters:
                add(resolve_template(template, str(ch["number"])), f"{label} (chapter {ch['number']})")
        elif key_kind == "numeral":
            for p in parts:
                add(resolve_template(template, p["numeral"]), f"{label} (part {p['numeral']})")

    # Catch-all: every *literal* (no '#' placeholder) plates/ path anywhere
    # in the scanned .tex files, whether or not it came from one of the
    # macros above -- this is the direct \includegraphics{plates/...} scan
    # the task asks for, and it also covers plain cover/frontispiece
    # inclusions that aren't behind any macro at all.
    for tex_glob in TEX_GLOBS:
        for tex_path in sorted(glob.glob(os.path.join(repo_root, tex_glob))):
            with open(tex_path, "r", encoding="utf-8") as f:
                text = _strip_tex_comments(f.read())
            rel_tex = os.path.relpath(tex_path, os.path.join(repo_root, WHITEPAPER_SUBDIR))
            for rx in (_INCLUDEGRAPHICS_RE, _IFFILEEXISTS_RE):
                for m in rx.finditer(text):
                    path = m.group(1).strip()
                    if path.startswith("plates/") and "#" not in path:
                        add(path, f"literal reference in {rel_tex}")

    return expected, problems


def check_tex_plate_paths(repo_root: str) -> list[str]:
    expected, failures = collect_expected_tex_paths(repo_root)
    whitepaper_root = os.path.join(repo_root, WHITEPAPER_SUBDIR)
    for rel_path, label in expected:
        full_path = os.path.join(whitepaper_root, rel_path)
        if not os.path.exists(full_path):
            failures.append(f"{label} references missing plate: {rel_path}")
    return failures


# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--repo-root",
        default=os.path.dirname(os.path.abspath(__file__)) + "/../..",
        help="Repository root (default: two levels up from this script).",
    )
    args = parser.parse_args()
    repo_root = os.path.abspath(args.repo_root)

    provenance_failures = check_all_provenance(repo_root)
    tex_failures = check_tex_plate_paths(repo_root)
    all_failures = provenance_failures + tex_failures

    for failure in all_failures:
        print(f"FAIL: {failure}")

    print(
        f"checked plate provenance and TeX plate paths: "
        f"{len(provenance_failures)} provenance failure(s), "
        f"{len(tex_failures)} TeX path failure(s)"
    )
    return 1 if all_failures else 0


if __name__ == "__main__":
    sys.exit(main())
