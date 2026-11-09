#!/usr/bin/env python3
"""Carry the licensed Suisse fonts to CI through repository secrets.

The publication Book is set in Suisse Intl, which is licensed to its owner and
must never be committed, uploaded as an artifact, or published. CI still has
to set the Book in it, or the deployed Book is a different book: Suisse and
the open-proof face paginate differently.

A repository secret holds at most 48 KB. The four OTF files are 681 KiB, and
xz shrinks the deterministic tar of them to 257 KiB, which base64 stretches to
342 KiB. So the archive travels as eight numbered slices, BOOK_SUISSE_00 to
BOOK_SUISSE_07, each under the limit. Two subcommands:

  upload [FONT_DIR]   run once by the licence holder, on a machine where `gh`
                      is signed in with admin rights on the repository. Checks
                      every file against the pinned SHA-256, packs, slices and
                      sets the secrets, and deletes any stale higher slices.
                      Nothing is written to disk.
  restore DEST        run by CI. Reads the slices from the environment,
                      reassembles, refuses anything but the four pinned files,
                      and writes them 0600 into DEST, which must lie outside
                      the repository. Exit 3 means no slices are configured.

The pins live in suisse-sha256.json beside this script. A digest of a font is
not the font, so publishing it costs nothing, and it is what lets CI refuse a
truncated, reordered or substituted secret instead of building a Book in the
wrong face.
"""
from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import io
import json
import lzma
import os
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PINS_FILE = HERE / "suisse-sha256.json"
PREFIX = "BOOK_SUISSE_"
# 45,000 base64 characters leaves headroom under GitHub's 48 KB secret limit.
SLICE = 45_000
# The workflows name exactly this many slots, so the upload refuses to need more.
SLOTS = 12
DEFAULT_REPO = "curiositech/port-daddy"
NOT_CONFIGURED = 3


class FontError(Exception):
    pass


def pins() -> dict[str, str]:
    data = json.loads(PINS_FILE.read_text(encoding="utf-8"))
    files = data["files"]
    if sorted(files) != sorted(f"SuisseIntl-{s}.otf" for s in
                               ("Regular", "RegularItalic", "Semibold", "SemiboldItalic")):
        raise FontError("suisse-sha256.json must pin exactly the four Suisse styles")
    return files


def slot(index: int) -> str:
    return f"{PREFIX}{index:02d}"


def pack(font_dir: Path, expected: dict[str, str]) -> bytes:
    """Deterministic tar.xz of the four pinned files, verified before packing."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w", format=tarfile.PAX_FORMAT) as tar:
        for name in sorted(expected):
            data = (font_dir / name).read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            if digest != expected[name]:
                raise FontError(f"{name}: SHA-256 {digest} is not the pinned {expected[name]}")
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o600
            info.mtime = 0
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            tar.addfile(info, io.BytesIO(data))
    return lzma.compress(buffer.getvalue(), preset=9 | lzma.PRESET_EXTREME)


def slices(archive: bytes) -> list[str]:
    text = base64.b64encode(archive).decode("ascii")
    parts = [text[i:i + SLICE] for i in range(0, len(text), SLICE)]
    if len(parts) > SLOTS:
        raise FontError(f"the archive needs {len(parts)} slices; the workflows name only {SLOTS}")
    return parts


def gather(env: dict[str, str]) -> list[str]:
    """Contiguous non-empty slices from slot 00. A gap is an error, not an end."""
    parts: list[str] = []
    seen_empty = False
    for index in range(SLOTS):
        value = env.get(slot(index), "").strip()
        if not value:
            seen_empty = True
            continue
        if seen_empty:
            raise FontError(f"{slot(index)} is set but an earlier slice is empty; re-run `ci_fonts.py upload`")
        parts.append(value)
    return parts


def unpack(parts: list[str], expected: dict[str, str]) -> dict[str, bytes]:
    try:
        archive = base64.b64decode("".join(parts), validate=True)
        raw = lzma.decompress(archive)
    except (binascii.Error, lzma.LZMAError) as error:
        raise FontError(f"the font slices do not reassemble ({error}); re-run `ci_fonts.py upload`") from None
    out: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as tar:
        for member in tar.getmembers():
            if not member.isfile() or member.name not in expected or member.name in out:
                raise FontError(f"unexpected archive member {member.name!r}")
            handle = tar.extractfile(member)
            if handle is None:
                raise FontError(f"unreadable archive member {member.name!r}")
            data = handle.read()
            digest = hashlib.sha256(data).hexdigest()
            if digest != expected[member.name]:
                raise FontError(f"{member.name}: SHA-256 {digest} is not the pinned {expected[member.name]}")
            out[member.name] = data
    missing = sorted(set(expected) - set(out))
    if missing:
        raise FontError(f"the archive lacks {', '.join(missing)}")
    return out


def restore(dest: Path, env: dict[str, str]) -> int:
    parts = gather(env)
    if not parts:
        print("Suisse fonts are not configured: no BOOK_SUISSE_00 secret.", file=sys.stderr)
        return NOT_CONFIGURED
    fonts = unpack(parts, pins())
    target = dest.expanduser().resolve()
    if target == ROOT or target.is_relative_to(ROOT):
        raise FontError("the fonts must be restored outside the repository")
    target.mkdir(parents=True, exist_ok=True)
    target.chmod(0o700)
    for name, data in fonts.items():
        path = target / name
        with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "wb") as stream:
            stream.write(data)
    print(f"Restored {len(fonts)} pinned Suisse files from {len(parts)} slices.")
    return 0


def default_font_dir() -> Path | None:
    configured = os.environ.get("PD_BOOK_FONT_DIR")
    if configured:
        return Path(configured)
    candidate = Path.home() / "coding/tmp/book-private-fonts/suisse-intl-20260918/Suisse Intl/OTF"
    return candidate if candidate.is_dir() else None


def gh(args: list[str], *, stdin: str | None = None) -> str:
    result = subprocess.run(["gh", *args], input=stdin, text=True, capture_output=True)
    if result.returncode != 0:
        # gh's stderr names the failure; the secret value is never in argv.
        raise FontError(f"gh {' '.join(args[:3])} failed: {result.stderr.strip()}")
    return result.stdout


def upload(font_dir: Path, repo: str, dry_run: bool) -> int:
    parts = slices(pack(font_dir, pins()))
    print(f"Packed the four pinned Suisse files into {len(parts)} slices of at most {SLICE} characters.")
    if dry_run:
        return 0
    if shutil.which("gh") is None:
        raise FontError("`gh` is not installed")
    for index, part in enumerate(parts):
        gh(["secret", "set", slot(index), "--repo", repo], stdin=part)
        print(f"  set {slot(index)}")
    existing = {row["name"] for row in json.loads(gh(["secret", "list", "--repo", repo, "--json", "name"]))}
    for index in range(len(parts), SLOTS):
        if slot(index) in existing:
            gh(["secret", "delete", slot(index), "--repo", repo])
            print(f"  deleted stale {slot(index)}")
    print(f"Done. CI can now set the Book in Suisse for {repo}.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    up = sub.add_parser("upload", help="pack the fonts and set the repository secrets")
    up.add_argument("font_dir", nargs="?", type=Path)
    up.add_argument("--repo", default=DEFAULT_REPO)
    up.add_argument("--dry-run", action="store_true", help="pack and count slices without calling gh")
    down = sub.add_parser("restore", help="reassemble the fonts from BOOK_SUISSE_* in CI")
    down.add_argument("dest", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "restore":
            return restore(args.dest, dict(os.environ))
        font_dir = args.font_dir or default_font_dir()
        if font_dir is None:
            raise FontError("name the directory holding the four SuisseIntl-*.otf files, or set PD_BOOK_FONT_DIR")
        return upload(font_dir.expanduser(), args.repo, args.dry_run)
    except (FontError, OSError, KeyError, json.JSONDecodeError, tarfile.TarError) as error:
        print(f"ci_fonts.py: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
