#!/usr/bin/env python3
"""render_cover_plate.py -- the site's cover image is page one of the Book, nothing else.

    python3 scripts/whitepaper-plates/render_cover_plate.py --write [--pdf PATH]
    python3 scripts/whitepaper-plates/render_cover_plate.py --check

The banner on the home page and the masthead of /whitepaper show the cover of the
Book as published. Until 2026-10-19 that image was a hand-made raster of an older
cover (concentric arcs) that no longer matched page one of the PDF the site
serves, and the home page carried a watercolor jacket from another edition.
Both were reproductions that had drifted from the object they reproduced.

--write rasterises page one of the Book PDF (default: the committed
website-v2/public/whitepaper/coordination-papers-mega-volume.pdf; --pdf names a
fresh local build when the Book is being refreshed) at 1000x1429 and writes
website-v2/public/whitepaper/plates/cover-swiss.jpg, then records the source PDF's
SHA-256 in plates/PROVENANCE.json under plates.cover-swiss.

--check recomputes the committed PDF's SHA-256 and fails if it differs from the
one the plate was rendered from: a refreshed Book with a stale cover is a
mismatch between the site and the download, which is the drift this exists to
stop. Run it after every Book refresh (scripts/whitepaper-plates/README.md).
"""
import argparse, hashlib, io, json, os, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PDF = REPO / "website-v2/public/whitepaper/coordination-papers-mega-volume.pdf"
PLATES = REPO / "website-v2/public/whitepaper/plates"
OUT = PLATES / "cover-swiss.jpg"
PROV = PLATES / "PROVENANCE.json"
KEY = "cover-swiss"
SIZE = (1000, 1429)   # 7:10, the Book's trim, at the size every other cover raster used


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def render(pdf: Path) -> bytes:
    import pymupdf  # PyMuPDF; the figure gates already depend on it
    from PIL import Image
    doc = pymupdf.open(pdf)
    page = doc[0]
    zoom = SIZE[1] / page.rect.height
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    if img.size != SIZE:
        img = img.resize(SIZE, Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90, optimize=True, progressive=True)
    return buf.getvalue()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--pdf", type=Path, default=PDF, help="Book PDF to rasterise (default: the committed one)")
    a = ap.parse_args()
    if a.write == a.check:
        ap.error("choose exactly one of --write / --check")
    prov = json.loads(PROV.read_text())
    if a.check:
        entry = prov["plates"].get(KEY) or {}
        want, have = entry.get("source_sha256"), sha256(PDF)
        if not OUT.exists():
            print(f"FAIL: {OUT.relative_to(REPO)} is missing; run --write"); return 1
        if want != have:
            print(f"FAIL: {OUT.relative_to(REPO)} was rendered from a Book with sha256 {str(want)[:12]}…, "
                  f"the committed Book is {have[:12]}…; run --write after refreshing the Book"); return 1
        print(f"ok: cover plate matches the committed Book ({have[:12]}…)"); return 0
    data = render(a.pdf)
    OUT.write_bytes(data)
    prov["plates"][KEY] = {
        "file": OUT.name,
        "derived_from": "website-v2/public/whitepaper/coordination-papers-mega-volume.pdf, page 1 — the cover of the Book as published (the canonical PDF renders the Swiss edition)",
        "source_sha256": sha256(a.pdf),
        "source_pdf": str(a.pdf.relative_to(REPO)) if a.pdf.is_relative_to(REPO) else a.pdf.name,
        "render": "scripts/whitepaper-plates/render_cover_plate.py --write: page one rasterised at 1000x1429 with PyMuPDF and JPEG-encoded at quality 90; no image model was involved",
        "size": list(SIZE),
        "bytes": len(data),
        "final_aspect": "7:10",
        "use": "the Book's cover on the home-page banner (components/landing/LibraryBanner.tsx) and the masthead of /whitepaper; re-render with --write whenever the committed Book changes, and --check fails when it has not been",
    }
    PROV.write_text(json.dumps(prov, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {OUT.relative_to(REPO)} ({len(data)//1024} KB) from {a.pdf} ({prov['plates'][KEY]['source_sha256'][:12]}…)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
