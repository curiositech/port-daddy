#!/usr/bin/env python3
"""Every item a planning document schedules, against the registry that is
supposed to be the only place work exists.

The rule this enforces is the one the Book spends a chapter on and this
repository keeps failing: a claim is not a claim because it is written down,
it is a claim because it is a row an authority admitted. `roadmap_items` in
the daemon -- projected append-only to roadmap.snapshot.json -- is that
authority. A Markdown document that names work is a projection over those
rows and joins to them by slug. When it names work that has no row, it is not
a plan; it is a note about a plan somebody hopes to make.

That is the state as of 2026-09-08, and it is worth stating plainly rather
than discovering again in a month. The runtime is halted after the September
spend failure, so no session can mutate the registry, so every programme that
needs to record work writes prose instead: PR #10107's ten drydock packages
("proposed rather than registered", in its own words), PR #10108's authority
cutover, the Grand Harbor ledger's own programme cut. None of those slugs is
in the committed snapshot. The documents are not wrong to exist -- the work is
real and the authority is down -- but nothing was counting how far the prose
had drifted from the register, which is how you get four constitutions and no
database.

So this counts it. It reads every slug a document declares (`Roadmap-Item:`,
`Roadmap-Spawns:`, `link:<slug>`), diffs against the snapshot, and writes the
difference to docs/roadmap/unregistered.json: the queue of rows to write when
the authority comes back. --check fails when that file is stale, so the queue
cannot quietly grow.

It does NOT fail on the existence of unregistered items. Failing on those
today would only mean failing until the halt lifts, and a check that cannot
pass is a check nobody reads. It fails on the register being out of date,
which is a thing somebody can fix in the minute they notice it.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SNAPSHOT = REPO / "docs" / "roadmap" / "roadmap.snapshot.json"
REGISTER = REPO / "docs" / "roadmap" / "unregistered.json"

# Where a document is allowed to schedule work. Anything outside these trees is
# prose about the world, not about our work.
SEARCH_DIRS = ("docs", "studies", "skills")

# Two kinds of file name slugs without scheduling anything, and counting them
# would bury the real queue. A report records what a past run emitted -- the
# doc-chomp report alone quotes 121 slugs it once generated from headings, none
# of which anybody is proposing. A skill's reference or template shows the
# syntax by example. Neither is a plan. Everything else in these trees is.
SKIP_PATTERNS = (
    "docs/reports/",
    "/references/",
    "/templates/",
)

DECLARATION_RE = re.compile(
    r"^Roadmap-(?:Item|Spawns):\s*(?P<body>.+)$", re.MULTILINE
)
LINK_RE = re.compile(r"\blink:(?P<slug>[a-z0-9][a-z0-9-]{3,})\b")
# "none — <reason>" is a declaration that no item is needed, not a slug.
NONE_RE = re.compile(r"^\s*none\b", re.IGNORECASE)
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{3,}$")
# CSS pseudo-classes and the like sail past LINK_RE; they are not work.
NOT_WORK = {"hover", "focus", "active", "visited", "before", "after"}


def registry_slugs() -> set[str]:
    """Every slug the committed projection carries. A missing or unreadable
    snapshot is a hard failure: an empty registry would make every declared
    slug look unregistered, which is a loud wrong answer rather than a quiet
    one, but still a wrong answer."""
    if not SNAPSHOT.is_file():
        raise SystemExit(f"{SNAPSHOT.relative_to(REPO)} is missing; refusing to guess the registry")
    data = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    items = data if isinstance(data, list) else data.get("items") or data.get("roadmap_items") or []
    slugs = {str(i.get("slug") or i.get("id") or "").strip() for i in items}
    slugs.discard("")
    if not slugs:
        raise SystemExit(f"{SNAPSHOT.relative_to(REPO)} parsed to zero items; refusing to report every slug unregistered")
    return slugs


def declarations() -> list[dict]:
    """(slug, file, line, how) for every slug a document schedules."""
    found: list[dict] = []
    for top in SEARCH_DIRS:
        root = REPO / top
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*.md")):
            rel = path.relative_to(REPO).as_posix()
            if any(s in f"/{rel}" for s in SKIP_PATTERNS):
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            for m in DECLARATION_RE.finditer(text):
                body = m.group("body").strip()
                if NONE_RE.match(body):
                    continue
                line = text[: m.start()].count("\n") + 1
                for raw in re.split(r"[,\s]+", body):
                    slug = raw.strip().strip("`.,;")
                    if SLUG_RE.match(slug) and slug not in NOT_WORK:
                        found.append({"slug": slug, "file": rel, "line": line, "how": "declared"})
            for m in LINK_RE.finditer(text):
                slug = m.group("slug")
                if slug in NOT_WORK:
                    continue
                line = text[: m.start()].count("\n") + 1
                found.append({"slug": slug, "file": rel, "line": line, "how": "linked"})
    return found


def build() -> dict:
    known = registry_slugs()
    seen: dict[str, dict] = {}
    for d in declarations():
        if d["slug"] in known:
            continue
        entry = seen.setdefault(d["slug"], {"slug": d["slug"], "sources": []})
        entry["sources"].append({"file": d["file"], "line": d["line"], "how": d["how"]})
    register = sorted(seen.values(), key=lambda e: e["slug"])
    return {
        "note": (
            "Slugs a document schedules that the committed registry projection does not "
            "carry. This is a queue of rows to write when the roadmap authority is "
            "available, not a second registry: nothing here is scheduled work until it "
            "is a row. Regenerate with scripts/roadmap/check_unregistered.py --write."
        ),
        "registry_items": len(known),
        "unregistered": register,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--write", action="store_true", help="regenerate the register")
    ap.add_argument("--check", action="store_true", help="fail if the register is stale")
    a = ap.parse_args()

    current = build()
    rendered = json.dumps(current, indent=2) + "\n"

    if a.write:
        REGISTER.write_text(rendered, encoding="utf-8")
        print(f"wrote {REGISTER.relative_to(REPO)}: {len(current['unregistered'])} unregistered slug(s)")
        return 0

    if a.check:
        if not REGISTER.is_file():
            print(f"::error::{REGISTER.relative_to(REPO)} is missing; run --write")
            return 1
        if REGISTER.read_text(encoding="utf-8") != rendered:
            print(f"::error::{REGISTER.relative_to(REPO)} is stale; run --write")
            return 1
        print(f"unregistered register is current: {len(current['unregistered'])} slug(s) waiting on the authority")
        return 0

    for e in current["unregistered"]:
        where = ", ".join(f"{s['file']}:{s['line']}" for s in e["sources"][:3])
        print(f"{e['slug']:<48} {where}")
    print(f"-- {len(current['unregistered'])} declared slug(s) with no row in the registry "
          f"({current['registry_items']} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
