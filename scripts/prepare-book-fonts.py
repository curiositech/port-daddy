#!/usr/bin/env python3
"""Select private Suisse inputs, or an explicitly labelled open-font proof.

Writes only configuration into the ignored build directory. Never copies fonts
or the personal invoice/EULA into the repository or artifacts. PD_BOOK_FONT_DIR
points directly at the four purchased OTF files and selects Suisse.
PD_BOOK_FONT_PROFILE can explicitly request suisse or open-proof.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
STYLES = ("Regular", "RegularItalic", "Semibold", "SemiboldItalic")


def configuration(profile, font_dir):
    if profile not in ("suisse", "open-proof"):
        raise ValueError("PD_BOOK_FONT_PROFILE must be suisse or open-proof")
    if profile == "open-proof":
        if font_dir:
            raise ValueError("Remove PD_BOOK_FONT_DIR when requesting open-proof")
        return "\\def\\pdbookfontprofile{open-proof}\n", {"profile": profile}
    if not font_dir:
        raise ValueError("Suisse requires PD_BOOK_FONT_DIR; no automatic substitution")
    folder = Path(font_dir).expanduser().resolve(strict=True)
    if folder.is_relative_to(ROOT):
        raise ValueError("Purchased fonts must live outside the repository")
    if any(char in str(folder) for char in "{}%#\\\n\r"):
        raise ValueError("Font directory contains TeX-unsafe characters")
    hashes = {}
    for style in STYLES:
        path = folder / f"SuisseIntl-{style}.otf"
        if path.resolve().is_relative_to(ROOT):
            raise ValueError("Purchased fonts must live outside the repository")
        data = path.read_bytes()
        if data[:4] != b"OTTO":
            raise ValueError(f"Expected an OpenType/CFF font: {path.name}")
        hashes[path.name] = hashlib.sha256(data).hexdigest()
    source = ("\\def\\pdbookfontprofile{suisse}\n"
              "\\edef\\pdbookfontdir{\\detokenize{" + folder.as_posix() + "/}}\n")
    return source, {"profile": profile, "sha256": hashes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("build_dir", type=Path)
    args = parser.parse_args()
    folder = os.environ.get("PD_BOOK_FONT_DIR", "")
    profile = os.environ.get("PD_BOOK_FONT_PROFILE", "suisse" if folder else "open-proof")
    try:
        source, receipt = configuration(profile, folder)
        target = args.build_dir.resolve()
        if target.is_relative_to(ROOT) and not target.is_relative_to(ROOT / ".cache"):
            raise ValueError("Font configuration belongs in .cache, not a source/public directory")
        target.mkdir(parents=True, exist_ok=True)
        for name, content in (("pd-book-font-config.tex", source),
                              ("book-font-profile.json", json.dumps(receipt, indent=2) + "\n")):
            path = target / name
            with path.open("w", encoding="utf-8") as stream:
                stream.write(content)
            path.chmod(0o600)
    except (OSError, ValueError) as error:
        parser.exit(2, f"Book font configuration: {error}\n")
    print(f"Book font profile: {profile}")
    if profile == "open-proof":
        print("Source Sans proof only; not Suisse pagination/clearance evidence.", file=sys.stderr)


if __name__ == "__main__":
    main()
