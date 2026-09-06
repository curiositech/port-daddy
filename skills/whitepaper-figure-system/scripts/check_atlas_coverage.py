#!/usr/bin/env python3
r"""Fail when the seven whitepaper TeX sources and semantic atlas drift.

The checker deliberately uses source labels rather than printed figure numbers. It follows
\input and \include directives recursively, extracts every figure/figure* environment, and
accepts a figure label (fig:...) or algorithm-listing label (alg:...) as its durable identity.
Canonical roots and cross-volume reuse memberships come from the atlas. Other figure-like
environments and inclusion directives fail closed until the scanner is explicitly extended and
tested. Rendered semantic equivalence remains a contact-sheet review because source text cannot
honestly prove visual equivalence.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


FIGURE_RE = re.compile(
    r"\\begin\{figure\*?\}(.*?)\\end\{figure\*?\}", re.DOTALL
)
INPUT_RE = re.compile(r"\\(?:input|include)\s*\{([^}]+)\}")
LABEL_RE = re.compile(r"\\label\s*\{([^}]+)\}")
LISTING_LABEL_RE = re.compile(r"\blabel\s*=\s*\{((?:fig|alg):[^{}]+)\}")
ATLAS_ID_RE = re.compile(r"^\|\s*`([IVX]+/(?:fig|alg):[^`]+)`\s*\|", re.MULTILINE)
ATLAS_VOLUME_ROOT_RE = re.compile(
    r"^## Volume (?P<roman>[IVX]+):[^\n]*\n+"
    r"Canonical root: `(?P<root>[^`]+\.tex)`",
    re.MULTILINE,
)
REUSE_SECTION_RE = re.compile(
    r"^## Cross-volume reuse contracts\s*$\n(?P<body>.*?)(?=^##\s|\Z)",
    re.MULTILINE | re.DOTALL,
)
REUSE_MEMBER_RE = re.compile(r"`([IVX]+/(?:fig|alg):[^`]+)`")
REUSE_MEMBERS_CELL_RE = re.compile(
    r"`[IVX]+/(?:fig|alg):[^`]+`"
    r"(?:\s*,\s*`[IVX]+/(?:fig|alg):[^`]+`)*"
)
EXPECTED_VOLUMES = {"I", "II", "III", "IV", "V", "VI", "VII"}
ENVIRONMENT_RE = re.compile(r"\\begin\s*\{([^{}]+)\}")
UNSUPPORTED_INCLUDE_RE = re.compile(
    r"\\(subfile|import|subimport|inputfrom|subinputfrom|includefrom|subincludefrom)"
    r"\s*\{"
)
BUILD_PAPER_RE = re.compile(
    r'^\s*"(?P<src>[^"|]+)\|(?P<root>[^"|]+\.tex)\|[^\"]+"\s*$', re.MULTILINE
)
MEGA_PAPER_RE = re.compile(
    r"\{\s*roman:\s*'(?P<roman>[IVX]+)'[^{}\n]*"
    r"source:\s*'(?P<source>[^']+\.tex)'[^{}\n]*\}"
)


@dataclass(frozen=True)
class SourceFigure:
    atlas_id: str
    source: Path


@dataclass(frozen=True)
class AtlasRow:
    atlas_id: str
    reader_question: str
    grammar: str
    must_encode: str
    reject: str


@dataclass(frozen=True)
class ReuseContract:
    name: str
    members: tuple[str, ...]
    requirement: str


def strip_tex_comments(text: str) -> str:
    """Remove unescaped TeX comments while preserving line boundaries."""

    cleaned: list[str] = []
    for line in text.splitlines(keepends=True):
        cut = None
        for index, char in enumerate(line):
            if char != "%":
                continue
            backslashes = 0
            cursor = index - 1
            while cursor >= 0 and line[cursor] == "\\":
                backslashes += 1
                cursor -= 1
            if backslashes % 2 == 0:
                cut = index
                break
        if cut is None:
            cleaned.append(line)
        else:
            newline = "\n" if line.endswith("\n") else ""
            cleaned.append(line[:cut] + newline)
    return "".join(cleaned)


def resolve_include(parent: Path, raw_target: str) -> Path:
    target = Path(raw_target.strip())
    if not target.suffix:
        target = target.with_suffix(".tex")
    if target.is_absolute():
        return target.resolve()
    return (parent / target).resolve()


def unsupported_constructs(text: str, source: Path) -> list[str]:
    """Return unsupported figure-like environments or inclusion directives."""

    failures: list[str] = []
    for environment in ENVIRONMENT_RE.findall(text):
        is_figure_like = "figure" in environment.lower()
        is_algorithm_exhibit = environment in {"algorithm", "algorithm*"}
        if (is_figure_like or is_algorithm_exhibit) and environment not in {
            "figure",
            "figure*",
        }:
            failures.append(f"{source}: \\begin{{{environment}}}")
    for directive in UNSUPPORTED_INCLUDE_RE.findall(text):
        failures.append(f"{source}: \\{directive}{{...}}")
    return failures


def walk_tex(root: Path) -> list[tuple[Path, str]]:
    """Return each recursively included TeX file once, in reading order."""

    visited: set[Path] = set()
    ordered: list[tuple[Path, str]] = []

    def visit(path: Path) -> None:
        resolved = path.resolve()
        if resolved in visited:
            return
        if not resolved.is_file():
            if "\\" in str(path):
                # An \input whose path is built from a macro (the generated
                # per-chapter solutions file, sol-\pdchapterprefix) resolves
                # only at TeX time; it carries no figure environments.
                return
            raise FileNotFoundError(f"included TeX source does not exist: {resolved}")
        visited.add(resolved)
        text = strip_tex_comments(resolved.read_text(encoding="utf-8"))
        unsupported = unsupported_constructs(text, resolved)
        if unsupported:
            raise ValueError(
                "unsupported TeX construct; extend and test the atlas scanner first: "
                + "; ".join(unsupported)
            )
        ordered.append((resolved, text))
        for match in INPUT_RE.finditer(text):
            visit(resolve_include(resolved.parent, match.group(1)))

    visit(root)
    return ordered


def figure_label(block: str, source: Path) -> str:
    labels = [label.strip() for label in LABEL_RE.findall(block)]
    durable = [label for label in labels if label.startswith(("fig:", "alg:"))]
    if not durable:
        durable = [label.strip() for label in LISTING_LABEL_RE.findall(block)]
    unique = list(dict.fromkeys(durable))
    if not unique:
        raise ValueError(f"unlabeled figure environment in {source}")
    if len(unique) > 1:
        raise ValueError(
            f"ambiguous figure environment in {source}: {', '.join(unique)}"
        )
    return unique[0]


def extract_source_figures(
    repo_root: Path, canonical_roots: dict[str, str]
) -> list[SourceFigure]:
    figures: list[SourceFigure] = []
    for volume, relative_root in canonical_roots.items():
        root = (repo_root / relative_root).resolve()
        for source, text in walk_tex(root):
            for match in FIGURE_RE.finditer(text):
                label = figure_label(match.group(1), source)
                figures.append(SourceFigure(f"{volume}/{label}", source))
    return figures


def parse_atlas_row(line: str, line_number: int) -> AtlasRow:
    """Parse one five-field atlas row, rejecting structurally incomplete rows."""

    cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
    if len(cells) != 5:
        raise ValueError(
            f"atlas row {line_number} has {len(cells)} fields; expected exactly 5"
        )
    identifier = re.fullmatch(r"`([IVX]+/(?:fig|alg):[^`]+)`", cells[0])
    if not identifier:
        raise ValueError(f"atlas row {line_number} has an invalid stable ID")
    return AtlasRow(identifier.group(1), *cells[1:])


def extract_atlas_rows(atlas: Path) -> list[AtlasRow]:
    rows: list[AtlasRow] = []
    for line_number, line in enumerate(
        atlas.read_text(encoding="utf-8").splitlines(), start=1
    ):
        if ATLAS_ID_RE.match(line):
            rows.append(parse_atlas_row(line, line_number))
    return rows


def extract_atlas_ids(atlas: Path) -> list[str]:
    return [row.atlas_id for row in extract_atlas_rows(atlas)]


def extract_atlas_volume_roots(atlas: Path) -> dict[str, str]:
    """Read the seven canonical TeX roots from the human-facing atlas."""

    text = atlas.read_text(encoding="utf-8")
    matches = list(ATLAS_VOLUME_ROOT_RE.finditer(text))
    roots = {
        match.group("roman"): match.group("root")
        for match in matches
    }
    volumes = [match.group("roman") for match in matches]
    root_paths = [match.group("root") for match in matches]
    if (
        len(matches) != 7
        or set(volumes) != EXPECTED_VOLUMES
        or len(set(volumes)) != len(volumes)
        or len(set(root_paths)) != len(root_paths)
    ):
        raise ValueError("atlas must declare exactly one canonical root per volume I--VII")
    return roots


def extract_reuse_contracts(atlas: Path) -> list[ReuseContract]:
    """Parse the structured cross-volume reuse table from the atlas."""

    text = atlas.read_text(encoding="utf-8")
    section = REUSE_SECTION_RE.search(text)
    if not section:
        raise ValueError("atlas is missing the cross-volume reuse contracts section")
    contracts: list[ReuseContract] = []
    for line_number, line in enumerate(section.group("body").splitlines(), start=1):
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if cells[0] == "Contract" or all(
            cell and set(cell) <= {"-", ":"} for cell in cells
        ):
            continue
        if len(cells) != 3:
            raise ValueError(
                f"reuse contract row {line_number} has {len(cells)} fields; "
                "expected exactly 3"
            )
        name, raw_members, requirement = cells
        if not name or not requirement:
            raise ValueError(
                f"reuse contract row {line_number} has a blank name or requirement"
            )
        if not REUSE_MEMBERS_CELL_RE.fullmatch(raw_members):
            raise ValueError(
                f"reuse contract row {line_number} has an invalid members cell"
            )
        contracts.append(
            ReuseContract(
                name=name,
                members=tuple(REUSE_MEMBER_RE.findall(raw_members)),
                requirement=requirement,
            )
        )
    if not contracts:
        raise ValueError("atlas declares no cross-volume reuse contracts")
    return contracts


def reuse_contract_issues(
    contracts: Iterable[ReuseContract],
    atlas_ids: Iterable[str],
    source_ids: Iterable[str],
) -> list[str]:
    """Validate reuse membership; rendered equivalence remains a visual audit."""

    atlas_set = set(atlas_ids)
    source_set = set(source_ids)
    issues: list[str] = []
    names: list[str] = []
    memberships: list[str] = []
    for contract in contracts:
        names.append(contract.name)
        memberships.extend(contract.members)
        if len(contract.members) < 2:
            issues.append(f"{contract.name}:fewer-than-two-members")
        member_volumes = {member.split("/", 1)[0] for member in contract.members}
        if len(member_volumes) < 2:
            issues.append(f"{contract.name}:not-cross-volume")
        if len(set(contract.members)) != len(contract.members):
            issues.append(f"{contract.name}:duplicate-member")
        if not contract.requirement:
            issues.append(f"{contract.name}:missing-requirement")
        for member in contract.members:
            if member not in atlas_set:
                issues.append(f"{contract.name}:member-missing-from-atlas={member}")
            if member not in source_set:
                issues.append(f"{contract.name}:member-missing-from-source={member}")
    for name in duplicates(names):
        issues.append(f"duplicate-contract-name={name}")
    for member in duplicates(memberships):
        issues.append(f"member-in-multiple-contracts={member}")
    return sorted(issues)


def incomplete_atlas_rows(rows: Iterable[AtlasRow]) -> list[str]:
    issues: list[str] = []
    fields = ("reader_question", "grammar", "must_encode", "reject")
    for row in rows:
        for field in fields:
            if not getattr(row, field).strip():
                issues.append(f"{row.atlas_id}:{field}")
    return sorted(issues)


def canonical_roots_from_build_script(repo_root: Path) -> set[str]:
    text = (repo_root / "scripts/build-whitepapers.sh").read_text(encoding="utf-8")
    roots: set[str] = set()
    for match in BUILD_PAPER_RE.finditer(text):
        root = match.group("root")
        if root == "coordination-papers-mega-volume.tex":
            continue
        source_dir = match.group("src")
        if source_dir == "$PUB":
            source_dir = "website-v2/public/whitepaper"
        roots.add(f"{source_dir}/{root}")
    return roots


def canonical_roots_from_mega_generator(repo_root: Path) -> dict[str, str]:
    text = (repo_root / "scripts/generate-mega-whitepaper.mjs").read_text(
        encoding="utf-8"
    )
    return {
        match.group("roman"): match.group("source")
        for match in MEGA_PAPER_RE.finditer(text)
    }


def canonical_root_drift(
    repo_root: Path, expected_roots: dict[str, str]
) -> list[str]:
    expected = set(expected_roots.values())
    failures: list[str] = []
    build_roots = canonical_roots_from_build_script(repo_root)
    build_missing = sorted(expected - build_roots)
    build_extra = sorted(build_roots - expected)
    if build_missing:
        failures.append(f"build-whitepapers:missing={','.join(build_missing)}")
    if build_extra:
        failures.append(f"build-whitepapers:extra={','.join(build_extra)}")

    mega_mapping = canonical_roots_from_mega_generator(repo_root)
    for volume in sorted(set(expected_roots) | set(mega_mapping)):
        expected_source = expected_roots.get(volume)
        observed_source = mega_mapping.get(volume)
        if expected_source != observed_source:
            failures.append(
                f"mega-generator:{volume}:expected={expected_source}:"
                f"observed={observed_source}"
            )
    return failures


def duplicates(values: Iterable[str]) -> list[str]:
    return sorted(value for value, count in Counter(values).items() if count > 1)


def compare(
    source_figures: list[SourceFigure],
    atlas_ids: list[str],
    *,
    atlas_row_issues: list[str] | None = None,
    root_drift: list[str] | None = None,
    reuse_issues: list[str] | None = None,
) -> dict[str, object]:
    source_ids = [figure.atlas_id for figure in source_figures]
    source_set = set(source_ids)
    atlas_set = set(atlas_ids)
    return {
        "source_count": len(source_ids),
        "atlas_count": len(atlas_ids),
        "missing_from_atlas": sorted(source_set - atlas_set),
        "stale_in_atlas": sorted(atlas_set - source_set),
        "duplicate_source_ids": duplicates(source_ids),
        "duplicate_atlas_ids": duplicates(atlas_ids),
        "incomplete_atlas_rows": sorted(atlas_row_issues or []),
        "canonical_root_drift": sorted(root_drift or []),
        "reuse_contract_issues": sorted(reuse_issues or []),
    }


def is_clean(report: dict[str, object]) -> bool:
    return not any(
        report[key]
        for key in (
            "missing_from_atlas",
            "stale_in_atlas",
            "duplicate_source_ids",
            "duplicate_atlas_ids",
            "incomplete_atlas_rows",
            "canonical_root_drift",
            "reuse_contract_issues",
        )
    ) and report["source_count"] == report["atlas_count"]


def default_repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=default_repo_root())
    parser.add_argument(
        "--atlas",
        type=Path,
        help="atlas path; defaults to this skill's semantic-figure-atlas.md",
    )
    parser.add_argument("--json", action="store_true", dest="as_json")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    repo_root = args.repo_root.resolve()
    atlas = (
        args.atlas.resolve()
        if args.atlas
        else repo_root
        / "skills/whitepaper-figure-system/references/semantic-figure-atlas.md"
    )

    try:
        canonical_roots = extract_atlas_volume_roots(atlas)
        source_figures = extract_source_figures(repo_root, canonical_roots)
        atlas_rows = extract_atlas_rows(atlas)
        atlas_ids = [row.atlas_id for row in atlas_rows]
        source_ids = [figure.atlas_id for figure in source_figures]
        contracts = extract_reuse_contracts(atlas)
        report = compare(
            source_figures,
            atlas_ids,
            atlas_row_issues=incomplete_atlas_rows(atlas_rows),
            root_drift=canonical_root_drift(repo_root, canonical_roots),
            reuse_issues=reuse_contract_issues(contracts, atlas_ids, source_ids),
        )
    except (FileNotFoundError, OSError, ValueError) as error:
        if args.as_json:
            print(json.dumps({"ok": False, "error": str(error)}, indent=2))
        else:
            print(f"atlas coverage error: {error}", file=sys.stderr)
        return 2

    report["ok"] = is_clean(report)
    if args.as_json:
        print(json.dumps(report, indent=2, sort_keys=True))
    elif report["ok"]:
        print(
            "semantic atlas coverage: "
            f"OK ({report['source_count']} canonical figure/exhibit environments)"
        )
    else:
        print("semantic atlas coverage: FAILED", file=sys.stderr)
        for key in (
            "missing_from_atlas",
            "stale_in_atlas",
            "duplicate_source_ids",
            "duplicate_atlas_ids",
            "incomplete_atlas_rows",
            "canonical_root_drift",
            "reuse_contract_issues",
        ):
            values = report[key]
            if values:
                print(f"{key}:", file=sys.stderr)
                for value in values:
                    print(f"  - {value}", file=sys.stderr)
        print(
            f"source_count={report['source_count']} "
            f"atlas_count={report['atlas_count']}",
            file=sys.stderr,
        )
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
