#!/usr/bin/python3
"""Build a readable, multi-page Book figure contact sheet.

The Book figure QA runner emits ``results.json`` beside one rendered PDF and
PNG per figure and edition.  Its legacy contact sheet is intentionally compact
and useful as a quick index, but a chapter-sized run makes each row too small
for final visual review.  This script turns those existing artifacts into one
17 x 11 inch PDF with one figure per page and Swiss, Maritime, and Technical
renderings side by side.  Every page names the figure; every panel carries its
QA verdict, failed checks, warnings, and measured ink width when available.

PDF inputs are placed as PDF content, so vector type and rules remain sharp at
high zoom.  PNG and JPEG inputs are embedded at their native resolution.  All
sheet labels use PyMuPDF's built-in PDF fonts: no ImageMagick, system font, TeX,
or Book build is involved.

Inputs may be:

* a Book figure QA directory containing ``results.json``;
* a ``results.json`` file itself;
* a parent directory containing several QA directories; or
* rendered per-figure PDF/PNG/JPEG files (or a directory of them) whose path
  contains an edition component named ``swiss``, ``maritime``, or ``technical``.

When more than one QA root contains the same figure/edition (for example a
figure shared by two chapters), matching verdicts are deduplicated.  Conflicting
verdicts are fatal because silently selecting one would make the review sheet
lie.

Example:

    /usr/bin/python3 scripts/harbor-research/render_book_figure_contact_sheet.py \
      .cache/figure-qa-ch56-final/stp \
      .cache/figure-qa-ch56-final/he \
      --output .cache/figure-qa-ch56-final/ch5-6-contact-sheet.pdf
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

try:
    import fitz  # PyMuPDF
except ImportError as exc:  # pragma: no cover - exercised only on an unprovisioned host
    raise SystemExit(
        "PyMuPDF is required. Run this with the Book figure QA Python environment."
    ) from exc


EDITIONS = ("swiss", "maritime", "technical")
MEDIA_SUFFIXES = (".pdf", ".png", ".jpg", ".jpeg")
PAGE_WIDTH = 17 * 72
PAGE_HEIGHT = 11 * 72

INK = (0.10, 0.12, 0.15)
MUTED = (0.36, 0.39, 0.44)
RULE = (0.77, 0.79, 0.82)
PANEL_FILL = (0.985, 0.985, 0.98)
PASS = (0.08, 0.43, 0.28)
FAIL = (0.72, 0.13, 0.12)
UNKNOWN = (0.42, 0.34, 0.08)


class ContactSheetError(RuntimeError):
    """An input cannot be represented without making the sheet misleading."""


@dataclass
class Panel:
    slug: str
    edition: str
    media: Path | None
    status: str
    detail: str
    source: Path
    qa: bool = False


@dataclass
class Inventory:
    panels: dict[tuple[str, str], Panel]
    slugs: list[str]

    def add(self, panel: Panel) -> None:
        key = (panel.slug, panel.edition)
        current = self.panels.get(key)
        if current is None:
            self.panels[key] = panel
            if panel.slug not in self.slugs:
                self.slugs.append(panel.slug)
            return

        if current.qa and panel.qa and current.status != panel.status:
            raise ContactSheetError(
                f"conflicting QA verdicts for {panel.slug}/{panel.edition}: "
                f"{current.status} in {current.source} versus {panel.status} in {panel.source}"
            )

        # QA metadata outranks an unassessed direct-media discovery.  Between
        # otherwise equivalent records, prefer PDF so the sheet stays vector.
        if panel.qa and not current.qa:
            self.panels[key] = panel
        elif panel.qa == current.qa and _media_rank(panel.media) > _media_rank(current.media):
            self.panels[key] = panel


def _media_rank(path: Path | None) -> int:
    if path is None:
        return 0
    return 2 if path.suffix.lower() == ".pdf" else 1


def _code_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return sorted({str(item) for item in value if str(item).strip()})


def _qa_status(record: dict) -> tuple[str, str]:
    compiled = bool(record.get("compiled"))
    verdict = record.get("pass")
    failures = _code_list(record.get("figcheck_fail")) + _code_list(record.get("beauty_fail"))
    if record.get("too_wide"):
        failures.append("WIDTH")
    warnings = _code_list(record.get("beauty_warn"))

    if verdict is True:
        status = "PASS"
    elif verdict is False or not compiled:
        status = "FAIL"
    else:
        status = "UNASSESSED"

    parts = [status]
    if not compiled:
        parts.append("not compiled")
    if failures:
        parts.append("fail " + " ".join(sorted(set(failures))))
    if warnings:
        parts.append("warn " + " ".join(warnings))
    width = record.get("ink_width_in")
    if isinstance(width, (int, float)):
        parts.append(f"ink {width:.2f} in")
    return status, " | ".join(parts)


def _resolve_qa_media(results_path: Path, record: dict) -> Path | None:
    slug = str(record.get("figure", "")).strip()
    edition = str(record.get("edition", "")).strip().lower()
    artifact_dir = results_path.parent / edition / slug

    # A local PDF is the best source even if results.json names the PNG: the
    # PDF retains vector text and linework in the assembled review document.
    candidates = [artifact_dir / f"{slug}{suffix}" for suffix in MEDIA_SUFFIXES]
    recorded_png = record.get("png")
    if isinstance(recorded_png, str) and recorded_png.strip():
        named = Path(recorded_png)
        if not named.is_absolute():
            named = results_path.parent / named
        candidates.extend([named.with_suffix(".pdf"), named])

    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    return None


def _load_results(path: Path, inventory: Inventory) -> None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContactSheetError(f"cannot read QA results {path}: {exc}") from exc
    if not isinstance(payload, list):
        raise ContactSheetError(f"QA results must be a JSON list: {path}")

    for index, record in enumerate(payload):
        if not isinstance(record, dict):
            raise ContactSheetError(f"QA record {index} is not an object in {path}")
        slug = str(record.get("figure", "")).strip()
        edition = str(record.get("edition", "")).strip().lower()
        if not slug or edition not in EDITIONS:
            raise ContactSheetError(
                f"QA record {index} in {path} needs a figure and one of {', '.join(EDITIONS)}"
            )
        status, detail = _qa_status(record)
        inventory.add(
            Panel(
                slug=slug,
                edition=edition,
                media=_resolve_qa_media(path, record),
                status=status,
                detail=detail,
                source=path.resolve(),
                qa=True,
            )
        )


def _infer_direct_media(path: Path) -> tuple[str, str]:
    lower_parts = [part.lower() for part in path.parts]
    editions = [edition for edition in EDITIONS if edition in lower_parts]
    if len(editions) != 1:
        raise ContactSheetError(
            f"cannot infer one edition from {path}; put the file below a swiss, maritime, "
            "or technical directory"
        )
    edition = editions[0]
    slug = path.stem
    slug = re.sub(rf"(?:--|[-_]){re.escape(edition)}$", "", slug, flags=re.IGNORECASE)
    if not slug:
        raise ContactSheetError(f"cannot infer a figure slug from {path}")
    return slug, edition


def _add_direct_media(path: Path, inventory: Inventory) -> None:
    slug, edition = _infer_direct_media(path)
    inventory.add(
        Panel(
            slug=slug,
            edition=edition,
            media=path.resolve(),
            status="UNASSESSED",
            detail="UNASSESSED | rendered artifact only",
            source=path.resolve(),
            qa=False,
        )
    )


def _discover_input(path: Path, inventory: Inventory) -> None:
    if not path.exists():
        raise ContactSheetError(f"input does not exist: {path}")
    if path.is_file():
        if path.name == "results.json" or path.suffix.lower() == ".json":
            _load_results(path, inventory)
        elif path.suffix.lower() in MEDIA_SUFFIXES:
            _add_direct_media(path, inventory)
        else:
            raise ContactSheetError(f"unsupported input: {path}")
        return

    own_results = path / "results.json"
    if own_results.is_file():
        _load_results(own_results, inventory)
        return

    nested_results = sorted(path.rglob("results.json"))
    if nested_results:
        for results in nested_results:
            _load_results(results, inventory)
        return

    media = sorted(
        candidate
        for candidate in path.rglob("*")
        if candidate.is_file() and candidate.suffix.lower() in MEDIA_SUFFIXES
    )
    if not media:
        raise ContactSheetError(f"no QA results or rendered figure media below {path}")
    for candidate in media:
        _add_direct_media(candidate, inventory)


def collect_inventory(inputs: Iterable[Path]) -> Inventory:
    inventory = Inventory(panels={}, slugs=[])
    for path in inputs:
        _discover_input(path, inventory)
    if not inventory.slugs:
        raise ContactSheetError("no figures found")
    return inventory


def _content_rect(page: fitz.Page) -> fitz.Rect:
    rects: list[fitz.Rect] = []
    for drawing in page.get_drawings():
        rect = fitz.Rect(drawing["rect"]) & page.rect
        if not rect.is_empty and max(rect.width, rect.height) >= 0.5:
            rects.append(rect)
    for block in page.get_text("blocks"):
        if len(block) >= 5 and str(block[4]).strip():
            rect = fitz.Rect(block[:4]) & page.rect
            if not rect.is_empty:
                rects.append(rect)
    for image in page.get_image_info():
        rect = fitz.Rect(image["bbox"]) & page.rect
        if not rect.is_empty:
            rects.append(rect)

    if not rects:
        return page.rect
    content = fitz.Rect(rects[0])
    for rect in rects[1:]:
        content |= rect
    return (content + (-6, -6, 6, 6)) & page.rect


def _fit_rect(source: fitz.Rect, destination: fitz.Rect) -> fitz.Rect:
    if source.is_empty or source.width <= 0 or source.height <= 0:
        return destination
    scale = min(destination.width / source.width, destination.height / source.height)
    width = source.width * scale
    height = source.height * scale
    left = destination.x0 + (destination.width - width) / 2
    top = destination.y0 + (destination.height - height) / 2
    return fitz.Rect(left, top, left + width, top + height)


def _place_media(page: fitz.Page, panel: Panel, viewport: fitz.Rect) -> None:
    if panel.media is None:
        page.insert_textbox(
            viewport + (18, 18, -18, -18),
            "NO RENDERED ARTIFACT",
            fontsize=13,
            fontname="hebo",
            color=FAIL,
            align=fitz.TEXT_ALIGN_CENTER,
        )
        return

    suffix = panel.media.suffix.lower()
    try:
        if suffix == ".pdf":
            with fitz.open(panel.media) as source:
                if source.page_count < 1:
                    raise ContactSheetError(f"PDF has no pages: {panel.media}")
                source_page = source[0]
                clip = _content_rect(source_page)
                target = _fit_rect(clip, viewport + (8, 8, -8, -8))
                page.show_pdf_page(target, source, 0, clip=clip, keep_proportion=True)
        else:
            with fitz.open(panel.media) as source:
                if source.page_count < 1:
                    raise ContactSheetError(f"image has no pages: {panel.media}")
                source_rect = source[0].rect
            target = _fit_rect(source_rect, viewport + (8, 8, -8, -8))
            page.insert_image(target, filename=str(panel.media), keep_proportion=True)
    except ContactSheetError:
        raise
    except Exception as exc:
        raise ContactSheetError(f"cannot place {panel.media}: {exc}") from exc


def _status_color(status: str) -> tuple[float, float, float]:
    if status == "PASS":
        return PASS
    if status in {"FAIL", "MISSING"}:
        return FAIL
    return UNKNOWN


def _effective_status(panel: Panel | None) -> str:
    if panel is None:
        return "MISSING"
    if panel.media is None and panel.status != "FAIL":
        return "MISSING"
    return panel.status


def _overall_status(inventory: Inventory, slug: str) -> str:
    statuses = [
        _effective_status(inventory.panels.get((slug, edition))) for edition in EDITIONS
    ]
    if any(status in {"FAIL", "MISSING"} for status in statuses):
        return "FAIL"
    if any(status == "UNASSESSED" for status in statuses):
        return "UNASSESSED"
    return "PASS"


def _draw_page(
    page: fitz.Page,
    inventory: Inventory,
    slug: str,
    page_number: int,
    page_count: int,
    title: str,
) -> None:
    margin = 30
    column_gap = 12
    column_width = (PAGE_WIDTH - 2 * margin - 2 * column_gap) / 3
    overall = _overall_status(inventory, slug)

    page.insert_text((margin, 29), title, fontsize=10, fontname="helv", color=MUTED)
    page.insert_text((margin, 55), slug, fontsize=20, fontname="hebo", color=INK)
    status_label = f"FIGURE {overall}"
    label_width = fitz.get_text_length(status_label, fontname="hebo", fontsize=10)
    page.insert_text(
        (PAGE_WIDTH - margin - label_width, 52),
        status_label,
        fontsize=10,
        fontname="hebo",
        color=_status_color(overall),
    )
    page.draw_line((margin, 67), (PAGE_WIDTH - margin, 67), color=RULE, width=0.7)

    for index, edition in enumerate(EDITIONS):
        left = margin + index * (column_width + column_gap)
        right = left + column_width
        panel = inventory.panels.get((slug, edition))
        status = _effective_status(panel)
        if panel is None:
            detail = "MISSING | no artifact for this edition"
        elif panel.media is None and panel.status != "FAIL":
            detail = f"MISSING | QA {panel.status} | no rendered artifact"
        elif panel.media is None:
            detail = f"{panel.detail} | no rendered artifact"
        else:
            detail = panel.detail

        page.insert_text(
            (left, 91), edition.upper(), fontsize=12, fontname="hebo", color=INK
        )
        detail_rect = fitz.Rect(left, 98, right, 127)
        page.insert_textbox(
            detail_rect,
            detail,
            fontsize=7.8,
            lineheight=1.22,
            fontname="helv",
            color=_status_color(status),
        )

        viewport = fitz.Rect(left, 132, right, PAGE_HEIGHT - 30)
        page.draw_rect(viewport, color=RULE, fill=PANEL_FILL, width=0.7)
        if panel:
            _place_media(page, panel, viewport)
        else:
            page.insert_textbox(
                viewport + (18, 18, -18, -18),
                "MISSING EDITION ARTIFACT",
                fontsize=13,
                fontname="hebo",
                color=FAIL,
                align=fitz.TEXT_ALIGN_CENTER,
            )

    footer = f"Page {page_number}/{page_count} | 17 x 11 in review sheet | one figure per page"
    footer_width = fitz.get_text_length(footer, fontname="helv", fontsize=7.5)
    page.insert_text(
        (PAGE_WIDTH - margin - footer_width, PAGE_HEIGHT - 10),
        footer,
        fontsize=7.5,
        fontname="helv",
        color=MUTED,
    )


def render_contact_sheet(inventory: Inventory, output: Path, title: str) -> dict[str, int]:
    output = output.resolve()
    if output.suffix.lower() != ".pdf":
        raise ContactSheetError(f"output must be a PDF: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)

    doc = fitz.open()
    try:
        page_count = len(inventory.slugs)
        for page_number, slug in enumerate(inventory.slugs, start=1):
            page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
            _draw_page(page, inventory, slug, page_number, page_count, title)
        doc.set_metadata(
            {
                "title": title,
                "subject": "Book figure edition comparison and QA review",
                "creator": "render_book_figure_contact_sheet.py",
            }
        )
        doc.set_toc([[1, slug, index] for index, slug in enumerate(inventory.slugs, start=1)])
        handle = tempfile.NamedTemporaryFile(
            prefix=f".{output.name}.", suffix=".tmp", dir=output.parent, delete=False
        )
        temporary = Path(handle.name)
        handle.close()
        temporary.unlink()
        try:
            doc.save(temporary, garbage=4, deflate=True, clean=True)
            temporary.replace(output)
        finally:
            if temporary.exists():
                temporary.unlink()
    finally:
        doc.close()

    counts = {"PASS": 0, "FAIL": 0, "UNASSESSED": 0}
    missing_panels = 0
    for slug in inventory.slugs:
        overall = _overall_status(inventory, slug)
        counts[overall] += 1
        missing_panels += sum(
            (panel := inventory.panels.get((slug, edition))) is None or panel.media is None
            for edition in EDITIONS
        )
    counts["MISSING_PANELS"] = missing_panels
    return counts


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "inputs",
        nargs="+",
        type=Path,
        help="QA result roots/results.json files or rendered per-figure media",
    )
    parser.add_argument("--output", required=True, type=Path, help="multi-page PDF to write")
    parser.add_argument(
        "--title",
        default="Book figure review: Swiss / Maritime / Technical",
        help="running title printed on every page",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        inventory = collect_inventory(args.inputs)
        counts = render_contact_sheet(inventory, args.output, args.title)
    except ContactSheetError as exc:
        print(f"contact sheet: {exc}", file=sys.stderr)
        return 2

    output = args.output.resolve()
    print(f"wrote {len(inventory.slugs)}-page contact sheet: {output}")
    print(
        "figures: "
        f"PASS {counts['PASS']} | FAIL {counts['FAIL']} | "
        f"UNASSESSED {counts['UNASSESSED']} | missing panels {counts['MISSING_PANELS']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
