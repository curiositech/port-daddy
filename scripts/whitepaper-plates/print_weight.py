#!/usr/bin/env python3
"""Keep every plate the Book prints at print weight, so the Book stays publishable.

Why this exists. On 2026-10-13 the Book was committed at 74.7 MB and rolled back
the same day to the 10.4 MB build of 2026-10-06 (92edff5e0c). Nothing had gone
wrong in TeX. The plates added since were committed at generation weight: RGBA
PNGs of one to three megabytes for a figure that prints 1.3 in wide, and two
marginalia photographs of six megabytes each placed at 2,500 ppi. The build of
2026-10-19 measured 69 MB of images inside a 75 MB Book. Cloudflare Pages
refuses any file over 25 MiB, so that Book could not have been published even
if someone had tried, and `Read the Book (PDF)` kept pointing at October 6.

What it does. Every directory in POLICY carries the encoding the Book should
embed, the longest edge a plate needs at its printed size, the JPEG quality,
and a byte budget per file. `--check` fails when any governed file breaks its
policy. `--write` re-encodes the offenders in place and records what it did in
the plate's provenance: the PROVENANCE.json entry for swiss, technical and
interstitial plates, the <slug>.json sidecar for marginalia and margin
evidence. The original file is moved to .cache/plates-originals/ (git-ignored)
and its SHA-256 is written next to the derivative's, so the generation
provenance that the sidecars and tests pin survives the re-encoding.

Transparent margin art keeps its transparency. An RGBA plate becomes a
one-page PDF wrapper holding a JPEG (DCTDecode) with the original alpha as a
lossless SMask, which xdvipdfmx embeds unchanged. The paper shows through
exactly as before, on every edition's paper colour, and the cutout's edge is
the generated edge, not a flattened one.

    python3 scripts/whitepaper-plates/print_weight.py --check
    python3 scripts/whitepaper-plates/print_weight.py --write [--dir plates/swiss] [--force]

Both modes read pixels, so both need the readers every page measurement is
taken with (scripts/harbor-research/requirements-pdf.txt: Pillow, PyMuPDF).
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import io
import json
import os
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "website-v2/public/whitepaper"
ORIGINALS = ROOT / ".cache/plates-originals"
TOOL = "scripts/whitepaper-plates/print_weight.py"
RASTER = (".jpg", ".jpeg", ".png")
PAPER = (0xFB, 0xF7, 0xEF)  # hhpaper, the Book's page colour (coordination-papers-mega-volume-preamble.tex)

# fmt      what the Book embeds: 'jpg' (a JPEG file), 'pdf' (a one-page PDF
#          wrapper: JPEG + lossless SMask, for art that is a cutout)
# cap      longest edge in pixels the printed size needs; measured 2026-10-19
#          from where each directory's plates land in the production spreads
# q        JPEG quality
# budget   bytes per file; --check fails above it
# only     govern only these extensions (figures/ also holds vector PDFs and
#          lossless PNG diagrams, which are not plates)
POLICY: dict[str, dict] = {
    # Full-page and chapter-opening art, placed up to 7 in wide at 121 ppi:
    # the pixels are already the floor, so only the quality moves.
    "plates/swiss":           dict(fmt="jpg", cap=1800, q=80, budget=520_000),
    "plates/technical":       dict(fmt="jpg", cap=1800, q=80, budget=520_000),
    # The maritime edition's plates and the site's cover reproductions.
    "plates":                 dict(fmt="jpg", cap=1800, q=85, budget=520_000),
    # Margin photographs, placed at most 1.3 in wide: 1000 px is 770 ppi.
    "plates/marginalia":      dict(fmt="jpg", cap=1000, q=85, budget=320_000),
    # Generated analogies, cutouts on the page, at most 1.9 in wide: 720 px is
    # 380 ppi, and the lossless SMask is half of every wrapper's weight.
    "plates/margin-evidence": dict(fmt="pdf", cap=720, q=85, budget=220_000),
    # Full-page reflective plates, 6 in wide at their native 1024 px (171 ppi).
    "plates/interstitial":    dict(fmt="jpg", cap=1600, q=88, budget=520_000),
    # Raster figures, at most 6 in wide.
    "figures":                dict(fmt="jpg", cap=2000, q=85, budget=450_000, only=(".jpg", ".jpeg")),
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def governed(dirrel: str, pol: dict) -> list[Path]:
    base = WEB / dirrel
    if not base.is_dir():
        return []
    exts = set(pol.get("only", RASTER))
    if pol["fmt"] == "pdf":
        exts.add(".pdf")
    return sorted(p for p in base.iterdir() if p.is_file() and p.suffix.lower() in exts)


def wrapper_dims(path: Path) -> tuple[int, int]:
    import fitz  # PyMuPDF

    with fitz.open(path) as doc:
        images = doc[0].get_images(full=True)
        if not images:
            raise ValueError(f"{path} holds no image")
        return images[0][2], images[0][3]


def dims(path: Path) -> tuple[int, int]:
    if path.suffix.lower() == ".pdf":
        return wrapper_dims(path)
    from PIL import Image

    with Image.open(path) as im:
        return im.size


def violations(dirrel: str, pol: dict, path: Path) -> list[str]:
    out = []
    ext = path.suffix.lower()
    if pol["fmt"] == "jpg" and ext == ".png":
        out.append("is a PNG where the Book embeds JPEG")
    if pol["fmt"] == "pdf" and ext != ".pdf":
        out.append("is a raster where the Book embeds a JPEG+SMask wrapper (.pdf)")
    size = path.stat().st_size
    if size > pol["budget"]:
        out.append(f"{size:,} bytes, over the {pol['budget']:,} byte budget")
    w, h = dims(path)
    if max(w, h) > pol["cap"]:
        out.append(f"{w}x{h} px, longer than the {pol['cap']} px edge its placement needs")
    return out


def check(dirs: list[str]) -> int:
    failures = []
    for dirrel in dirs:
        pol = POLICY[dirrel]
        files = governed(dirrel, pol)
        total = sum(p.stat().st_size for p in files)
        print(f"{dirrel:24s} {len(files):3d} files {total/1e6:6.1f} MB")
        for p in files:
            for v in violations(dirrel, pol, p):
                failures.append(f"{dirrel}/{p.name}: {v}")
    if failures:
        print(f"\nFAIL: {len(failures)} plate(s) are not at print weight; run `{TOOL} --write`:")
        for f in failures:
            print("  " + f)
        return 1
    print("\nOK: every governed plate is at print weight")
    return 0


def encode_jpeg(im, q: int) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
    return buf.getvalue()


def encode_png_gray(im) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def wrap(rgb_jpeg: bytes, alpha_png: bytes | None, w: int, h: int) -> bytes:
    """A one-page PDF whose only content is the JPEG, with the alpha as its SMask."""
    import fitz

    doc = fitz.open()
    page = doc.new_page(width=w, height=h)
    page.insert_image(page.rect, stream=rgb_jpeg, mask=alpha_png)
    data = doc.tobytes(deflate=True, garbage=3)
    doc.close()
    return data


def derive(src: Path, pol: dict) -> tuple[bytes, str, dict]:
    from PIL import Image

    with Image.open(src) as im:
        im.load()
        alpha = im.getchannel("A") if "A" in im.getbands() else None
        rgb = im.convert("RGB")
    if alpha is not None:
        # Coverage under 3% and over 97% is invisible on paper but costs the
        # mask its compressibility (the generator's cutouts carry a haze of
        # 1-7 and 248-254 values around every edge); snap it, keep the rest.
        alpha = alpha.point(lambda a: 0 if a < 8 else (255 if a > 247 else a))
        # The RGB under fully transparent pixels is whatever the generator left
        # there, usually noise, and a JPEG spends most of its bytes on noise.
        # Matte it flat (the Book's paper, so a semi-transparent edge pixel
        # blends toward the colour it will sit on); every pixel with any
        # coverage keeps its own colour.
        covered = alpha.point(lambda a: 255 if a > 0 else 0)
        rgb = Image.composite(rgb, Image.new("RGB", rgb.size, PAPER), covered)
    cap, q = pol["cap"], pol["q"]
    for attempt in range(6):
        w, h = rgb.size
        scale = min(1.0, cap / max(w, h))
        out_rgb = rgb.resize((round(w * scale), round(h * scale)), Image.LANCZOS) if scale < 1 else rgb
        out_alpha = alpha.resize(out_rgb.size, Image.LANCZOS) if (alpha is not None and scale < 1) else alpha
        jpeg = encode_jpeg(out_rgb, q)
        if pol["fmt"] == "pdf":
            data = wrap(jpeg, encode_png_gray(out_alpha) if out_alpha is not None else None, *out_rgb.size)
            ext, enc = ".pdf", f"PDF wrapper: JPEG quality {q} (DCTDecode) with the original alpha as a lossless SMask"
        else:
            data, ext, enc = jpeg, ".jpg", f"JPEG quality {q}, progressive, optimized"
        if len(data) <= pol["budget"]:
            break
        # Over budget: spend quality first (three steps), then pixels.
        if q > pol["q"] - 15:
            q -= 5
        else:
            cap = int(cap * 0.9)
    meta = dict(encoding=enc, pixels=list(out_rgb.size), quality=q, long_edge_cap=cap,
                transparency="SMask" if (pol["fmt"] == "pdf" and alpha is not None) else "none")
    return data, ext, meta


def _dump(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


def record(dirrel: str, stem: str, old_name: str, old_sha: str, new: Path, meta: dict) -> list[str]:
    """Write what happened into the plate's provenance; return the files touched."""
    touched = []
    today = _dt.date.today().isoformat()
    note = {
        "date": today, "tool": TOOL, "from": old_name, "source_sha256": old_sha,
        "file": new.name, "sha256": sha256(new), "bytes": new.stat().st_size,
        "pixels": meta["pixels"], "encoding": meta["encoding"], "transparency": meta["transparency"],
    }
    prov = WEB / dirrel / "PROVENANCE.json"
    if prov.is_file():
        doc = json.loads(prov.read_text())
        for section in ("plates", "frontispieces"):
            entries = doc.get(section)
            if not isinstance(entries, dict):
                continue
            entry = entries.get(stem)
            if entry is None:
                entry = next((e for e in entries.values() if isinstance(e, dict) and e.get("file") == old_name), None)
            if not isinstance(entry, dict):
                continue
            entry["file"] = new.name
            if "size" in entry:
                entry["size"] = meta["pixels"]
            if "bytes" in entry:
                entry["bytes"] = note["bytes"]
            if "sha256" in entry:
                entry["sha256"] = note["sha256"]
            if isinstance(entry.get("post"), str):
                post = re.sub(r"\s*Re-encoded to print weight on .*?print_weight\.source_sha256\.", "", entry["post"]).rstrip()
                entry["post"] = post + f" Re-encoded to print weight on {today} by {TOOL} ({meta['encoding']}); the generated original's SHA-256 is in print_weight.source_sha256."
            entry["print_weight"] = note
            _dump(prov, doc)
            touched.append(str(prov.relative_to(ROOT)))
            break
    sidecar = WEB / dirrel / f"{stem}.json"
    if sidecar.is_file():
        data = json.loads(sidecar.read_text())
        data["print_master"] = note
        _dump(sidecar, data)
        touched.append(str(sidecar.relative_to(ROOT)))
    return touched


def kept_original(dirrel: str, stem: str) -> Path | None:
    for ext in RASTER:
        cand = ORIGINALS / dirrel / f"{stem}{ext}"
        if cand.is_file():
            return cand
    return None


def recorded_derivative_sha(dirrel: str, stem: str) -> str | None:
    """The SHA-256 this tool last recorded for the derivative at <dirrel>/<stem>."""
    prov = WEB / dirrel / "PROVENANCE.json"
    if prov.is_file():
        doc = json.loads(prov.read_text())
        for section in ("plates", "frontispieces"):
            entry = (doc.get(section) or {}).get(stem) if isinstance(doc.get(section), dict) else None
            if isinstance(entry, dict) and isinstance(entry.get("print_weight"), dict):
                return entry["print_weight"].get("sha256")
    sidecar = WEB / dirrel / f"{stem}.json"
    if sidecar.is_file():
        data = json.loads(sidecar.read_text())
        if isinstance(data.get("print_master"), dict):
            return data["print_master"].get("sha256")
    return None


def write(dirs: list[str], force: bool) -> int:
    before = after = 0
    rows = []
    for dirrel in dirs:
        pol = POLICY[dirrel]
        for src in governed(dirrel, pol):
            original = kept_original(dirrel, src.stem)
            is_raster = src.suffix.lower() != ".pdf"
            if original is None and not is_raster:
                continue  # a wrapper whose source is not on this machine; nothing to re-derive from
            replaced = False
            if original is not None and is_raster and sha256(src) != recorded_derivative_sha(dirrel, src.stem):
                # A raster at the governed path that is not the derivative this
                # tool wrote is a replacement (or a restored original): it
                # supersedes the kept original, which would otherwise be re-used
                # forever and silently discard the new art.
                original.unlink()
                original = None
                replaced = True
            if original is not None and not force:
                continue  # already a derivative of a kept original
            if original is None and not replaced and not violations(dirrel, pol, src) and not force:
                continue
            source = original or src
            old_size, old_sha = source.stat().st_size, sha256(source)
            data, ext, meta = derive(source, pol)
            if original is None:
                keep = ORIGINALS / dirrel / src.name
                keep.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(src), str(keep))
                for stale in ORIGINALS.joinpath(dirrel).glob(f"{src.stem}.*"):
                    if stale != keep:
                        stale.unlink()  # one kept original per stem
            elif src.suffix.lower() != ext:
                src.unlink()
            dst = src.with_suffix(ext)
            dst.write_bytes(data)
            touched = record(dirrel, src.stem, source.name, old_sha, dst, meta)
            before += old_size
            after += len(data)
            rows.append((dirrel, source.name, old_size, dst.name, len(data), meta["pixels"], meta["quality"], touched))
    if not rows:
        print("nothing to do: every governed plate is already at print weight")
        return 0
    for dirrel, old, osz, new, nsz, px, q, touched in rows:
        print(f"{dirrel}/{old} {osz/1e3:7.0f}K -> {new} {nsz/1e3:6.0f}K @ {px[0]}x{px[1]} q{q}"
              + (f"  [{', '.join(Path(t).name for t in touched)}]" if touched else ""))
    print(f"\n{len(rows)} plate(s): {before/1e6:.1f} MB -> {after/1e6:.1f} MB; originals kept under {ORIGINALS.relative_to(ROOT)}/")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="fail if any governed plate is not at print weight")
    mode.add_argument("--write", action="store_true", help="re-encode offending plates in place and record it")
    ap.add_argument("--dir", action="append", help="limit to one policy directory (repeatable)")
    ap.add_argument("--force", action="store_true", help="with --write: re-encode every governed raster, not only offenders")
    args = ap.parse_args()
    dirs = args.dir or list(POLICY)
    unknown = [d for d in dirs if d not in POLICY]
    if unknown:
        print(f"no policy for {unknown}; known: {list(POLICY)}", file=sys.stderr)
        return 2
    os.chdir(ROOT)
    return write(dirs, args.force) if args.write else check(dirs)


if __name__ == "__main__":
    sys.exit(main())
