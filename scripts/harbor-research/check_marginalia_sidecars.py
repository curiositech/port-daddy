#!/usr/bin/env python3
"""check_marginalia_sidecars.py — every marginalia print plate has a complete,
allow-listed sidecar.

Wave 12 §12.2 rule (HANDOFF-TEXTBOOK.md §4): "no image without a sidecar JSON
(source URL, author, licence in the allow-list, retrieval date) and a credits
page." This checker enforces the sidecar half of that rule for every print
plate committed under plates/marginalia/.

For every website-v2/public/whitepaper/plates/marginalia/<slug>.jpg this
checks that:

  (a) a sidecar website-v2/public/whitepaper/plates/marginalia/<slug>.json
      exists and is valid JSON;
  (b) it carries every required field, non-empty (booleans/None where the
      task allows them -- e.g. a public-domain image has no licence_url --
      are fine; a field that's simply absent, or an empty string where a
      string is expected, is not):
        subject, commons_file_page, original_url, sha1, width, height,
        artist, credit, licence_short, licence_url, attribution_required,
        usage_terms, retrieved, crop
  (c) sha1 looks like a sha1 (40 hex chars);
  (d) width and height are positive integers;
  (e) licence_short is on the allow-list: public domain, CC0, PD-old, or
      CC BY / CC BY-SA 2.0 through 4.0 in any jurisdiction (e.g. "CC BY-SA
      2.5 si", "CC BY-SA 2.0 de", "CC BY 3.0"). A bespoke permission (the
      Coase case) or any other licence fails this check -- such an image
      should not have a plate at all (see coase.NOT-CLEARED.json for the
      pattern: record the rejection, don't commit the plate).

A slug with a .json sidecar but no matching .jpg plate is not an error here
(a sidecar may be prepared ahead of a plate, e.g. while the lead decides a
crop) -- this checker is about plates that exist, not about sidecars that
don't yet have one.

Exit status: 0 if every plate's sidecar is complete and allow-listed, 1
otherwise (each failure is printed, then a summary line).

Usage:
    python3 scripts/harbor-research/check_marginalia_sidecars.py [--repo-root PATH]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys

REQUIRED_FIELDS = [
    "subject",
    "commons_file_page",
    "original_url",
    "sha1",
    "width",
    "height",
    "artist",
    "credit",
    "licence_short",
    "licence_url",
    "attribution_required",
    "usage_terms",
    "retrieved",
    "crop",
]

# Fields that are allowed to be a "falsy but present" value (None, False, 0
# is not applicable here) -- everything else must be a non-empty string.
NULLABLE_FIELDS = {"licence_url"}
BOOLEAN_FIELDS = {"attribution_required"}

def plates_dir(repo_root: str) -> str:
    """The one place the marginalia plates and their sidecars live, relative
    to a repository root. Factored out so other checkers (margin_lint.py,
    the tufte-evidence-design skill's mechanical margin-apparatus checks) can
    reuse this exact path instead of re-deriving it and risking drift."""
    return os.path.join(
        repo_root, "website-v2", "public", "whitepaper", "plates", "marginalia"
    )


SHA1_RE = re.compile(r"^[0-9a-f]{40}$")

# Allow-list: public domain / CC0 / PD-old / CC BY or CC BY-SA 2.0-4.0 in any
# jurisdiction suffix (e.g. "2.0 de", "2.5 si", "3.0 Unported", "4.0").
_PD_PATTERNS = [
    re.compile(r"^public domain$", re.IGNORECASE),
    re.compile(r"^cc0", re.IGNORECASE),
    re.compile(r"^pd-old", re.IGNORECASE),
]
_CC_BY_RE = re.compile(
    r"^cc\s*by(-sa)?\s*(2\.0|2\.5|3\.0|4\.0)\b", re.IGNORECASE
)


def licence_allowed(licence_short: str) -> bool:
    s = licence_short.strip()
    if any(p.match(s) for p in _PD_PATTERNS):
        return True
    if _CC_BY_RE.match(s):
        return True
    return False


def check_sidecar(slug: str, path: str) -> list[str]:
    """Return a list of failure strings for this one sidecar (empty if clean)."""
    failures = []
    if not os.path.exists(path):
        return [f"{slug}: no sidecar found at {path}"]

    with open(path, "r", encoding="utf-8") as f:
        raw = f.read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        return [f"{slug}: {path} is not valid JSON ({e})"]

    if not isinstance(data, dict):
        return [f"{slug}: {path} does not contain a JSON object"]

    for field in REQUIRED_FIELDS:
        if field not in data:
            failures.append(f"{slug}: sidecar missing required field '{field}'")
            continue
        value = data[field]
        if field in BOOLEAN_FIELDS:
            if not isinstance(value, bool):
                failures.append(
                    f"{slug}: field '{field}' should be a boolean, got {value!r}"
                )
            continue
        if field in NULLABLE_FIELDS:
            if value is not None and not (isinstance(value, str) and value.strip()):
                failures.append(
                    f"{slug}: field '{field}' should be null or a non-empty string, got {value!r}"
                )
            continue
        if field in ("width", "height"):
            if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                failures.append(
                    f"{slug}: field '{field}' should be a positive integer, got {value!r}"
                )
            continue
        # everything else: non-empty string
        if not isinstance(value, str) or not value.strip():
            failures.append(
                f"{slug}: field '{field}' should be a non-empty string, got {value!r}"
            )

    # sha1 shape (only if present and a string)
    sha1 = data.get("sha1")
    if isinstance(sha1, str) and sha1 and not SHA1_RE.match(sha1):
        failures.append(f"{slug}: sha1 '{sha1}' does not look like a 40-char hex sha1")

    # licence allow-list
    licence_short = data.get("licence_short")
    if isinstance(licence_short, str) and licence_short:
        if not licence_allowed(licence_short):
            failures.append(
                f"{slug}: licence_short '{licence_short}' is not on the allow-list "
                "(public domain / CC0 / PD-old / CC BY or CC BY-SA 2.0-4.0, any jurisdiction)"
            )

    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root",
        default=os.path.dirname(os.path.abspath(__file__)) + "/../..",
        help="Repository root (default: two levels up from this script).",
    )
    args = parser.parse_args()
    repo_root = os.path.abspath(args.repo_root)

    dir_path = plates_dir(repo_root)
    jpg_paths = sorted(glob.glob(os.path.join(dir_path, "*.jpg")))

    if not jpg_paths:
        print(f"no plates found under {dir_path} -- nothing to check")
        return 0

    all_failures: list[str] = []
    checked = 0
    for jpg_path in jpg_paths:
        slug = os.path.splitext(os.path.basename(jpg_path))[0]
        sidecar_path = os.path.join(dir_path, f"{slug}.json")
        failures = check_sidecar(slug, sidecar_path)
        all_failures.extend(failures)
        checked += 1

    for failure in all_failures:
        print(f"FAIL: {failure}")

    print(f"checked {checked} plate(s), {len(all_failures)} failure(s)")
    return 1 if all_failures else 0


if __name__ == "__main__":
    sys.exit(main())
