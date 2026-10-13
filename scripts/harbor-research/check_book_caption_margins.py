#!/usr/bin/env python3
"""Require every captioned Book exhibit to have its caption in the outer margin.

Uses the converged Book aux inventory, not a selected fragment sample. Missing,
duplicate, main-column, wrong-side and vertically overflowing captions fail.
Floating exhibits also require measured owner anchors in the matching aux:
being in the margin is insufficient when the caption is below its figure.
This checks placement only, never design quality or factual accuracy.
"""
import argparse
import json
import re
from pathlib import Path

import fitz

from export_book_visual_review import caption_records
from page_overflow import column, MARGIN_SEP, MARGIN_W, TEXT_FOOT, OFFPAGE_PAD


def separate_columns(block):
    """Split a reader-merged block on horizontal whitespace, never margin bounds.

    MuPDF can append an axis label to a nearby caption's text block. Connected
    horizontal ranges recover the separate columns without clipping an actual
    overlong caption line or assuming that the caption was placed correctly.
    """
    groups = []
    for line in block["lines"]:
        rect = fitz.Rect(line["bbox"])
        text = "".join(span["text"] for span in line["spans"])
        joined, separate = [], []
        for group in groups:
            if any(rect.x0 < r.x1 and r.x0 < rect.x1 for r, _ in group):
                joined.extend(group)
            else:
                separate.append(group)
        groups = separate + [joined + [(rect, text)]]
    out = []
    for group in groups:
        rect = fitz.Rect(group[0][0])
        for r, _ in group[1:]:
            rect |= r
        out.append((*rect, "\n".join(text for _, text in group)))
    return out


def caption_blocks_unclipped(page):
    original = fitz.Rect(page.mediabox)
    try:
        page.set_mediabox(fitz.Rect(-OFFPAGE_PAD, -OFFPAGE_PAD,
                                   original.width + OFFPAGE_PAD,
                                   original.height + OFFPAGE_PAD))
        blocks = []
        for block in page.get_text("dict")["blocks"]:
            if block.get("type") != 0:
                continue
            for rect_text in separate_columns(block):
                blocks.append(tuple(v - OFFPAGE_PAD for v in rect_text[:4])
                              + (rect_text[4],))
        return blocks
    finally:
        page.set_mediabox(original)


def with_continuations(first, blocks):
    """Include wrapped prose/math that the PDF reader split into other blocks.

    No horizontal clipping: a long path in a later block must still fail. A
    new numbered caption starts its own record. Adjacent marginalia may be
    included conservatively; the full-page collision check also examines them.
    """
    found = [first]
    rect = fitz.Rect(first[:4])
    remaining = [b for b in blocks if b is not first]
    changed = True
    while changed:
        changed = False
        for block in remaining[:]:
            candidate = fitz.Rect(block[:4])
            if re.match(r"^\s*(?:Figure|Table|Listing)\s*\d", block[4]):
                continue
            if (candidate.y0 >= rect.y0 and candidate.y0 <= rect.y1 + 18
                    and candidate.x0 < rect.x1 and rect.x0 < candidate.x1):
                rect |= candidate
                found.append(block)
                remaining.remove(block)
                changed = True
    return (*rect, "\n".join(b[4] for b in found))


def bounds_issues(rect, text_left, text_right, side, slack=2.0):
    left = text_right + MARGIN_SEP if side == "R" else text_left - MARGIN_SEP - MARGIN_W
    right = left + MARGIN_W
    issues = []
    if rect[0] < left - slack or rect[2] > right + slack:
        issues.append("not wholly in the outer margin")
    if rect[1] < 0.85 * 72 - slack:
        issues.append("above the text block")
    if rect[3] > TEXT_FOOT + slack:
        issues.append("below the text block")
    return issues


def exhibit_records(aux):
    """Read shipped exhibit tops separately from the allocator's caption tops."""
    positions = {}
    for match in re.finditer(r"\\zref@newlabel\{pde-(\d+)\}\{([^\n]+)\}", aux):
        properties = dict(re.findall(r"\\(posx|posy|abspage)\{(-?\d+)\}", match[2]))
        if len(properties) == 3:
            positions[match[1]] = {k: int(v) for k, v in properties.items()}
    records = {}
    pattern = r"\\pdexhibitrecord\{(\w+)\}\{([^}]+)\}\{(\d+)\}\{([\d.]+)pt\}\{([\d.]+)pt\}"
    for kind, number, ident, height, width in re.findall(pattern, aux):
        key = (kind, number)
        if key in records:
            raise ValueError(f"Duplicate exhibit owner: {kind} {number}")
        if ident not in positions:
            raise ValueError(f"Missing shipped exhibit anchor: {kind} {number}")
        records[key] = dict(positions[ident], id=ident,
                            height=float(height)*72/72.27, width=float(width)*72/72.27)
    return records


def margin_placements(aux):
    """Complete caption boxes cannot borrow height from neighboring notes."""
    records = {}
    pattern = r"\\pdmarginplacement\{(\d+)\}\{(\d+)\}\{([\d.-]+)pt\}\{([\d.]+)pt\}"
    for ident, page, top, height in re.findall(pattern, aux):
        if ident in records:
            raise ValueError("Duplicate shipped margin placement: " + ident)
        records[ident] = dict(page=int(page), top=float(top)*72/72.27,
                              height=float(height)*72/72.27)
    return records


def adjacency_issues(caption, exhibit, max_top_drift=24):
    """A caption begins beside its owner, not beside the following paragraph.

    Two text lines permit a small margin collision adjustment. Even within
    that allowance, a caption starting below the entire exhibit must fail.
    Moving body prose down to match a tall caption is never the remedy.
    """
    issues = []
    if caption[1] >= exhibit[3] + 2 or caption[3] <= exhibit[1] - 2:
        issues.append("caption detached from exhibit (no vertical overlap)")
    if abs(caption[1] - exhibit[1]) > max_top_drift:
        issues.append("caption top more than two lines from exhibit top")
    return issues


def ink_width_issues(width, column_width, tolerance=1):
    """Use the measured ink box, not the narrower wrapper used by TeX."""
    if width > column_width + tolerance:
        return ["exhibit exceeds body column; recompose without shrinking labels"]
    return []


def audit(pdf):
    aux = pdf.with_suffix(".aux")
    if not aux.is_file():
        raise ValueError("The matching converged Book .aux is required; do not check a detached PDF.")
    aux_text = aux.read_text()
    records = caption_records(aux_text)
    owners = exhibit_records(aux_text)
    placements = margin_placements(aux_text)
    if not owners:
        raise ValueError("No exhibit-owner geometry; rebuild with the shared caption layout before auditing.")
    if not records:
        raise ValueError("No caption inventory; refusing an empty check.")
    results = []
    with fitz.open(pdf) as book:
        names = book.resolve_names()
        pages = {}
        for record in records:
            destination = names.get(record["destination"])
            if not destination or destination.get("page", -1) < 0:
                raise ValueError("Missing caption destination: " + record["destination"])
            index = destination["page"]
            page = book[index]
            # PDF's default when PageLabels is omitted is physical Arabic
            # numbering (as in the small regression fixture).
            folio = page.get_label() if book.get_page_labels() else str(index + 1)
            if folio != record["folio"]:
                raise ValueError("Book/aux pagination mismatch: " + record["destination"])
            if index not in pages:
                pages[index] = (column(page, index + 1), caption_blocks_unclipped(page))
            geometry, blocks = pages[index]
            # This is a typeset identifier, not interpretation of prose.
            start = re.compile(r"^\s*" + record["kind"].title() + r"\s*"
                               + re.escape(record["number"]) + r"[.:](?:\s|$)")
            matches = [with_continuations(b, blocks) for b in blocks if start.match(b[4])]
            issues = []
            owner_rect = None
            caption_rect = None
            owner = owners.get((record["kind"], record["number"]))
            if owner:
                if owner["abspage"] != index + 1:
                    issues.append("caption and exhibit on different pages")
                x = owner["posx"] / 65536 * 72/72.27
                y = page.rect.height - owner["posy"] / 65536 * 72/72.27
                owner_rect = (x, y, x+owner["width"], y+owner["height"])
                issues.extend(ink_width_issues(owner["width"], geometry[1] - geometry[0]))
                placed = placements.get(owner["id"])
                if not placed:
                    issues.append("missing registered caption geometry")
                else:
                    if placed["page"] != index + 1:
                        issues.append("registered caption and exhibit on different pages")
                    left = (geometry[1] + MARGIN_SEP if geometry[2] == "R"
                            else geometry[0] - MARGIN_SEP - MARGIN_W)
                    caption_rect = (left, placed["top"], left+MARGIN_W,
                                    placed["top"]+placed["height"])
                    issues.extend(adjacency_issues(caption_rect, owner_rect))
            elif record["kind"] == "figure":
                issues.append("missing figure-owner geometry")
            if len(matches) != 1:
                issues.append(f"expected one caption block; found {len(matches)}")
            for block in matches:
                issues.extend(bounds_issues(block[:4], *geometry))
            results.append({
                "kind": record["kind"], "number": record["number"],
                "pdf_page": index + 1, "folio": record["folio"],
                "side": geometry[2], "labels": record["labels"],
                "rects": [[round(v, 2) for v in b[:4]] for b in matches],
                "exhibit_rect": [round(v, 2) for v in owner_rect] if owner_rect else None,
                "registered_caption_rect": [round(v, 2) for v in caption_rect] if caption_rect else None,
                "adjacency_checked": caption_rect is not None,
                "issues": issues,
            })
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        results = audit(args.pdf)
    except ValueError as exc:
        parser.exit(1, str(exc) + "\n")
    failures = [r for r in results if r["issues"]]
    if args.json:
        print(json.dumps({"captions": len(results), "failures": len(failures),
                          "adjacency_checked": sum(r["adjacency_checked"] for r in results),
                          "scope": "All numbered captions: margin bounds. Recorded floating owners: adjacency and ink width. Non-floating tables/listings: bounds only. Design and factual accuracy remain separate reviews.",
                          "results": results}, indent=2))
    else:
        print(f"{len(results)} Book captions checked; {len(failures)} placement failures")
        for r in failures:
            print(f"p{r['pdf_page']} {r['kind']} {r['number']}: " + "; ".join(r["issues"]))
    return int(bool(failures))


if __name__ == "__main__":
    raise SystemExit(main())
