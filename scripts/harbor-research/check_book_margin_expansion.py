#!/usr/bin/env python3
"""Check this marginalia expansion in its assembled Book, not a fragment.

Verifies each new sketch's stable registered ID and actual PDF text, and each
portrait/object photo's decoded image digest and unique placement. This is an
inventory check; audit_book_layout owns geometry and humans inspect the pages.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

import fitz
from audit_book_layout import margin_records

ROOT = Path(__file__).resolve().parents[2]
WITNESSES = {
    "wal-exposure-window": "The bracketed span has no fixed duration.",
    "heartbeat-suspicion": "Silence between heartbeats is normal.",
    "consent-region": "Both bounds must hold",
    "heavy-tail-shape": "Analytic examples, not measurements.",
    "no-mint-split": "The parent is debited once.",
    "downtime-amplification": "A queue amplifies downtime",
    "equivocation-pair": "Both signatures verify.",
    "certificate-lifetime": "Policy expires first in this schematic.",
}
PHOTOS = ("hobbes", "sen", "hickman", "movable-type-photo", "leviathan")
SOURCE_FILES = (
    "book/single-writer-kernel.tex",
    "book/legible-swarm.tex",
    "book/anchor-protocol-whitepaper.tex",
    "book/sealed-harbor.tex",
    "book/spawn-to-person.tex",
    "book/harbor-economy.tex",
    "book/agent-transactions-whitepaper.tex",
    "book/federated-harbor-whitepaper.tex",
    "book/figures/pd-margin-sketches.tex",
    "book/figures/pd-margin-layout.tex",
    "book/figures/pd-margin-evidence.tex",
    "book/figures/pd-marginalia-credits.tex",
    "book/figures/fig-sealed-laundering-fork.tex",
    "docs/harbor-research/exposition/MARGINALIA-PLACEMENT.md",
    "tests/harbor-research/test_book_margin_sketches.py",
)


def inspect(pdf):
    aux = pdf.with_suffix(".aux").read_text()
    _, placed, geometry_issues = margin_records(pdf.with_suffix(".log").read_text())
    records = re.findall(r"\\pdmarginexhibitrecord\{([^}]+)\}\{(\d+)\}", aux)
    errors, sketches, images = [], [], []
    with fitz.open(pdf) as book:
        page_text = [re.sub(r"\s+", " ", p.get_text()) for p in book]
        # Stable aux identities own the inventory. A unique printed caption
        # phrase verifies presence without requiring a redundant heading.
        for stable_id, witness in WITNESSES.items():
            ids = [int(n) for name, n in records if name == stable_id]
            placements = [p for p in placed if p["id"] in ids]
            pages = [i + 1 for i, text in enumerate(page_text) if witness in text]
            if len(ids) != 1 or len(placements) != 1 or len(pages) != 1:
                errors.append(f"{stable_id}: non-unique/missing record, placement or printed witness")
            elif book[pages[0] - 1].get_label() != placements[0]["folio"]:
                errors.append(f"{stable_id}: text and registered page disagree")
            sketches.append(dict(id=stable_id, text_witness=witness, pdf_pages=pages, placements=placements))

        digest_pages = {}
        for i, page in enumerate(book, 1):
            for item in page.get_image_info(hashes=True):
                digest_pages.setdefault(item["digest"], []).append(
                    dict(pdf_page=i, folio=page.get_label(), bounds=list(item["bbox"])))
        for slug in PHOTOS:
            asset = ROOT / f"book/plates/marginalia/{slug}.jpg"
            pix = fitz.Pixmap(str(asset))
            if pix.colorspace.n != 3:
                pix = fitz.Pixmap(fitz.csRGB, pix)
            matches = digest_pages.get(pix.digest, [])
            if len(matches) != 1:
                errors.append(f"{slug}: expected one printed image, got {len(matches)}")
            images.append(dict(asset=slug, placements=matches))
        inputs = list(SOURCE_FILES) + [
            f"book/plates/marginalia/{slug}.{ext}"
            for slug in PHOTOS[:-1] for ext in ("jpg", "json")]
        source_sha256 = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
                         for name in inputs}
        return dict(pdf=str(pdf), sha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),
                    pages=len(book), sketches=sketches, photos=images,
                    source_sha256=source_sha256,
                    errors=errors, margin_geometry_issues=geometry_issues,
                    scope="Eight added sketches, four sourced images and the retained single Leviathan; not a design verdict.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = inspect(args.pdf)
    args.out.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: result[k] for k in ("pages", "sha256", "errors", "margin_geometry_issues")}))
    raise SystemExit(bool(result["errors"] or result["margin_geometry_issues"]))
