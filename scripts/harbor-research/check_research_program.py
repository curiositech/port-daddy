#!/usr/bin/env python3
"""The research program's one source of record, and the guard that keeps the
website honest about it.

`docs/harbor-research/program.json` is what the site's /research page renders.
Half of it is written by hand (studies, open problems, deep dives, wrong turns,
planned lifts, the papers) and half is derived from the files that already
carry the truth:

  results        <- docs/harbor-research/library-index.json   (every executed result)
  estate         <- whitepaper/corpus.json                    (every mechanized artifact)
  critiqueLedger <- docs/harbor-research/critique-ledger.json (every review item)

The website keeps a byte-identical mirror at
`website-v2/src/data/harborResearchProgram.json` (the same pattern as
whitepaper/textbook.json -> website-v2/src/data/textbook.json), because the
site build cannot reach outside its own tree.

What this check enforces, so that a change to the program is a change the
site must carry:

  1. the derived sections equal a fresh derivation (edit the index, the corpus
     manifest, or the ledger and program.json goes stale until `--sync`);
  2. the hand-written inventories match the repository: every research paper
     source, every deep-dive directory, every wrong-turn script, and every
     study directory is listed, and nothing listed is missing;
  3. every `source` path the program cites exists;
  4. the five silences in PORTHOLE-DECISIONS-FROM-THE-BOOK.md are all listed
     as open problems (the count under that heading equals the count here);
  5. the site mirror is byte-identical to the source.

Run `python3 scripts/harbor-research/check_research_program.py --sync` to
regenerate the derived sections and the mirror; run without flags to check.
Standard library only; no TeX, no Node.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PROGRAM = REPO / "docs/harbor-research/program.json"
SCHEMA = REPO / "docs/harbor-research/program.schema.json"
MIRROR = REPO / "website-v2/src/data/harborResearchProgram.json"
LIBRARY_INDEX = REPO / "docs/harbor-research/library-index.json"
CORPUS = REPO / "whitepaper/corpus.json"
CRITIQUE_LEDGER = REPO / "docs/harbor-research/critique-ledger.json"
TEXTBOOK = REPO / "whitepaper/textbook.json"
PAPER_TEX_DIR = REPO / "docs/harbor-research/tex"
DEEP_DIVES_DIR = REPO / "docs/harbor-research/deep-dives"
WRONG_TURNS_DIR = REPO / "docs/harbor-research/wrong-turns"
STUDIES_DIR = REPO / "studies"
SILENCES_DOC = REPO / "docs/harbor-research/exposition/PORTHOLE-DECISIONS-FROM-THE-BOOK.md"
SILENCES_HEADING = "## The silences, which are the book's next work"

DERIVED_KEYS = ("results", "estate", "critiqueLedger")
HAND_KEYS = ("papers", "deepDives", "wrongTurns", "studies", "plannedLifts", "openProblems")

STANDALONE_FILE_RE = re.compile(r"paper(\d+)\.tex$")


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def dump(data) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


# ---------------------------------------------------------------------------
# Derived sections
# ---------------------------------------------------------------------------


def derive_results() -> list[dict]:
    """One row per library-index entry: the executed result, where it lives,
    and which standalone paper carries it (None for chapter-only results)."""
    index = load(LIBRARY_INDEX)
    rows = []
    for entry in index["entries"]:
        standalone = entry.get("standalone") or {}
        paper = None
        match = STANDALONE_FILE_RE.search(standalone.get("file") or "")
        if match:
            paper = int(match.group(1))
        rows.append(
            {
                "id": entry["id"],
                "kind": entry["kind"],
                "title": entry["title"],
                "oneBreath": entry["one_breath"],
                "status": entry["status"],
                "chapters": sorted({c["chapter"] for c in entry.get("chapters", [])}),
                "paper": paper,
                "scripts": list(entry.get("scripts", [])),
                "numbers": {
                    "verified": sum(1 for n in entry.get("numbers", []) if n.get("tag") == "verified"),
                    "internal": sum(1 for n in entry.get("numbers", []) if n.get("tag") == "internal"),
                },
                "mechanized": bool(entry.get("mechanization")),
            }
        )
    return rows


def derive_estate() -> dict:
    corpus = load(CORPUS)
    formal = corpus["formalArtifacts"]
    research = corpus["researchProgramArtifacts"]
    everything = formal + research
    by_method = Counter(a.get("method", "unspecified") for a in formal)
    by_kind = Counter(a["kind"] for a in formal)
    ci = Counter((a.get("ci") or {}).get("status", "unknown") for a in everything)
    not_current = [
        {"id": a["id"], "status": a["status"], "method": a.get("method", "unspecified"), "note": a.get("evidencePolicy", "")}
        for a in everything
        if a["status"] != "current"
    ]
    return {
        "manifest": "whitepaper/corpus.json",
        "formalArtifacts": len(formal),
        "researchProgramArtifacts": len(research),
        "ci": {"wired": ci.get("wired", 0), "retired": ci.get("retired", 0)},
        "byMethod": dict(sorted(by_method.items())),
        "byKind": dict(sorted(by_kind.items())),
        "notCurrent": sorted(not_current, key=lambda a: a["id"]),
    }


STATUS_RE = re.compile(r"^(DONE|DECLINED|IN-WAVE-\d+|OPEN)", re.IGNORECASE)


def derive_critique_ledger() -> dict:
    rows = load(CRITIQUE_LEDGER)
    tally: Counter[str] = Counter()
    for row in rows:
        status = str(row.get("Status", "")).strip()
        match = STATUS_RE.match(status)
        key = match.group(1).upper() if match else "OTHER"
        if key.startswith("IN-WAVE"):
            key = "IN-WAVE"
        tally[key] += 1
    return {
        "source": "docs/harbor-research/critique-ledger.json",
        "total": len(rows),
        "done": tally.get("DONE", 0),
        "declined": tally.get("DECLINED", 0),
        "inWave": tally.get("IN-WAVE", 0),
        "other": tally.get("OTHER", 0) + tally.get("OPEN", 0),
    }


def derive_all() -> dict:
    return {
        "results": derive_results(),
        "estate": derive_estate(),
        "critiqueLedger": derive_critique_ledger(),
    }


# ---------------------------------------------------------------------------
# JSON Schema validation (stdlib only)
# ---------------------------------------------------------------------------
#
# A small draft-07 subset: exactly the keywords program.schema.json uses, and
# nothing more. If the schema is ever extended with a keyword this validator
# does not implement, that must not pass silently -- SchemaKeywordNotSupported
# is raised so the gap is caught, not swallowed.

SCHEMA_ANNOTATION_KEYWORDS = {"$schema", "$id", "title", "description"}
SCHEMA_CONSTRAINT_KEYWORDS = {
    "type",
    "const",
    "enum",
    "required",
    "properties",
    "additionalProperties",
    "items",
    "minLength",
    "minimum",
    "pattern",
}

JSON_SCHEMA_TYPES: dict[str, tuple[type, ...]] = {
    "object": (dict,),
    "array": (list,),
    "string": (str,),
    # bool is a subclass of int in Python; JSON Schema treats them as distinct.
    "integer": (int,),
    "number": (int, float),
    "boolean": (bool,),
    "null": (type(None),),
}


class SchemaKeywordNotSupported(Exception):
    """Raised when program.schema.json uses a keyword this validator does not
    implement, so an expanded schema can never pass unchecked."""


def _matches_type(instance, type_name: str) -> bool:
    types = JSON_SCHEMA_TYPES[type_name]
    if isinstance(instance, bool) and bool not in types:
        return False
    return isinstance(instance, types)


def validate_schema(instance, schema: dict, pointer: str = "") -> list[str]:
    """Validate `instance` against a draft-07 JSON Schema `schema`, returning
    a list of violations, each naming a JSON-pointer-like `pointer` to the
    offending value. Raises SchemaKeywordNotSupported for any keyword this
    validator does not implement."""
    unknown = set(schema) - SCHEMA_ANNOTATION_KEYWORDS - SCHEMA_CONSTRAINT_KEYWORDS
    if unknown:
        raise SchemaKeywordNotSupported(
            f"program.schema.json uses keyword(s) {sorted(unknown)} at "
            f"{pointer or '/'}, which check_research_program.py's validator does not implement"
        )

    here = pointer or "/"
    problems: list[str] = []

    if "const" in schema and instance != schema["const"]:
        problems.append(f"{here}: expected constant {schema['const']!r}, got {instance!r}")

    if "enum" in schema and instance not in schema["enum"]:
        problems.append(f"{here}: {instance!r} is not one of {schema['enum']}")

    if "type" in schema and not _matches_type(instance, schema["type"]):
        problems.append(f"{here}: expected type {schema['type']!r}, got {type(instance).__name__}")
        return problems  # further keywords assume the right shape; skip them

    if "minLength" in schema and isinstance(instance, str) and len(instance) < schema["minLength"]:
        problems.append(f"{here}: length {len(instance)} is below minLength {schema['minLength']}")

    if "minimum" in schema and isinstance(instance, (int, float)) and instance < schema["minimum"]:
        problems.append(f"{here}: {instance} is below minimum {schema['minimum']}")

    if "pattern" in schema and isinstance(instance, str) and not re.search(schema["pattern"], instance):
        problems.append(f"{here}: {instance!r} does not match pattern {schema['pattern']!r}")

    if isinstance(instance, dict):
        for key in schema.get("required", []):
            if key not in instance:
                problems.append(f"{here}: missing required property {key!r}")
        properties = schema.get("properties", {})
        for key, subschema in properties.items():
            if key in instance:
                problems.extend(validate_schema(instance[key], subschema, f"{pointer}/{key}"))
        if schema.get("additionalProperties") is False:
            extra = sorted(set(instance) - set(properties))
            if extra:
                problems.append(f"{here}: unexpected propert{'y' if len(extra) == 1 else 'ies'} {extra}")

    if isinstance(instance, list) and "items" in schema:
        for i, item in enumerate(instance):
            problems.extend(validate_schema(item, schema["items"], f"{pointer}/{i}"))

    return problems


# ---------------------------------------------------------------------------
# Inventory checks
# ---------------------------------------------------------------------------


def silence_count() -> int:
    text = SILENCES_DOC.read_text(encoding="utf-8")
    if SILENCES_HEADING not in text:
        return -1
    tail = text.split(SILENCES_HEADING, 1)[1]
    tail = tail.split("\n## ", 1)[0]
    return len(re.findall(r"^\d+\.\s+\*\*", tail, flags=re.MULTILINE))


def check(program: dict) -> list[str]:
    problems: list[str] = []
    rel = lambda p: str(p.relative_to(REPO))  # noqa: E731

    for key in DERIVED_KEYS + HAND_KEYS:
        if key not in program:
            problems.append(f"program.json is missing the '{key}' section")
    if problems:
        return problems

    # 1. derived sections are fresh
    fresh = derive_all()
    for key in DERIVED_KEYS:
        if program[key] != fresh[key]:
            problems.append(
                f"'{key}' is stale against its source of record; run check_research_program.py --sync"
            )

    # 1b. every standalone file cited by the library index is one derive_results
    # can actually attribute to a paper; a file that matches no paper silently
    # drops that attribution, so surface it instead of losing it quietly.
    for entry in load(LIBRARY_INDEX)["entries"]:
        file = (entry.get("standalone") or {}).get("file")
        if file and not STANDALONE_FILE_RE.search(file):
            problems.append(f"results: {entry['id']} standalone file {file!r} does not match any paper")

    # 2. inventories match the tree
    tex_papers = sorted(int(m.group(1)) for p in PAPER_TEX_DIR.glob("paper*.tex") if (m := re.match(r"paper(\d+)\.tex$", p.name)))
    listed_papers = sorted(p["number"] for p in program["papers"])
    if tex_papers != listed_papers:
        problems.append(f"papers: {rel(PAPER_TEX_DIR)} has {tex_papers}, program.json lists {listed_papers}")

    dive_dirs = sorted(p.name for p in DEEP_DIVES_DIR.iterdir() if p.is_dir())
    listed_dives = sorted(d["dir"] for d in program["deepDives"])
    if dive_dirs != listed_dives:
        problems.append(f"deepDives: on disk {dive_dirs}, listed {listed_dives}")
    for dive in program["deepDives"]:
        if not (DEEP_DIVES_DIR / dive["dir"] / "findings.md").exists():
            problems.append(f"deepDives: {dive['dir']} has no findings.md")

    turn_files = sorted(p.name for p in WRONG_TURNS_DIR.glob("*.py"))
    listed_turns = sorted(t["file"] for t in program["wrongTurns"])
    if turn_files != listed_turns:
        problems.append(f"wrongTurns: on disk {turn_files}, listed {listed_turns}")

    study_dirs = sorted(p.name for p in STUDIES_DIR.iterdir() if p.is_dir()) if STUDIES_DIR.exists() else []
    listed_studies = sorted(s["dir"] for s in program["studies"])
    if study_dirs != listed_studies:
        problems.append(f"studies: on disk {study_dirs}, listed {listed_studies}")

    # 3. every cited source exists
    def walk(node, trail="program"):
        if isinstance(node, dict):
            for k, v in node.items():
                if k in ("source", "protocol", "tex", "findings") and isinstance(v, str):
                    path = v.split("#", 1)[0]
                    if not (REPO / path).exists():
                        problems.append(f"{trail}.{k}: {path} does not exist")
                else:
                    walk(v, f"{trail}.{k}")
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, f"{trail}[{i}]")

    for key in HAND_KEYS:
        walk(program[key], key)

    # 4. the silences are all listed
    silences_listed = [p for p in program["openProblems"] if p.get("source", "").startswith(rel(SILENCES_DOC))]
    n_silences = silence_count()
    if n_silences < 0:
        problems.append(f"{rel(SILENCES_DOC)} no longer has the heading {SILENCES_HEADING!r}")
    elif n_silences != len(silences_listed):
        problems.append(
            f"openProblems: {rel(SILENCES_DOC)} names {n_silences} silences, program.json lists {len(silences_listed)} from it"
        )

    # chapters cited by hand-written sections exist in textbook.json
    chapters = {c["number"] for c in load(TEXTBOOK)["chapters"]}
    for key in ("openProblems", "plannedLifts", "studies"):
        for item in program[key]:
            for ch in item.get("chapters", []):
                if ch not in chapters:
                    problems.append(f"{key}: {item.get('id')} cites chapter {ch}, not in whitepaper/textbook.json")

    # 5. the program matches its own JSON Schema
    schema = load(SCHEMA)
    for problem in validate_schema(program, schema):
        problems.append(f"schema {problem}")

    # 6. the mirror is identical (byte-for-byte; its schema conformance
    # follows from being identical to the already-validated source).
    if not MIRROR.exists():
        problems.append(f"{rel(MIRROR)} is missing; run --sync")
    elif MIRROR.read_bytes() != PROGRAM.read_bytes():
        problems.append(f"{rel(MIRROR)} differs from {rel(PROGRAM)}; run --sync")

    return problems


def sync() -> None:
    program = load(PROGRAM)
    program.update(derive_all())
    text = dump(program)
    PROGRAM.write_text(text, encoding="utf-8")
    MIRROR.parent.mkdir(parents=True, exist_ok=True)
    MIRROR.write_text(text, encoding="utf-8")
    print(f"synced {PROGRAM.relative_to(REPO)} and {MIRROR.relative_to(REPO)}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("--sync", action="store_true", help="regenerate the derived sections and the site mirror")
    args = parser.parse_args(argv)
    if args.sync:
        sync()
    try:
        problems = check(load(PROGRAM))
    except SchemaKeywordNotSupported as exc:
        print(f"research program checker cannot validate the schema: {exc}", file=sys.stderr)
        return 1
    if problems:
        print("research program drift:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    program = load(PROGRAM)
    print(
        f"program.json is current: {len(program['results'])} results, "
        f"{program['estate']['formalArtifacts']} formal artifacts, "
        f"{len(program['openProblems'])} open problems, {len(program['studies'])} studies; mirror identical"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
