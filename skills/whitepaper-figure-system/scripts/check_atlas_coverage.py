#!/usr/bin/env python3
r"""Fail when the seven whitepaper TeX sources and semantic atlas drift.

The checker deliberately uses source labels rather than printed figure numbers. It follows
\input and \include directives recursively, extracts every figure environment, and accepts a
figure label (fig:...) or an algorithm-listing label (alg:...) as its durable identity.
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


CANONICAL_ROOTS = {
    "I": "whitepaper/legible-swarm.tex",
    "II": "whitepaper/single-writer-kernel.tex",
    "III": "website-v2/public/whitepaper/spawn-to-person.tex",
    "IV": "website-v2/public/whitepaper/harbor-economy.tex",
    "V": "website-v2/public/whitepaper/anchor-protocol-whitepaper.tex",
    "VI": "website-v2/public/whitepaper/agent-transactions-whitepaper.tex",
    "VII": "website-v2/public/whitepaper/federated-harbor-whitepaper.tex",
}

FIGURE_RE = re.compile(
    r"\\begin\{figure\*?\}(.*?)\\end\{figure\*?\}", re.DOTALL
)
INPUT_RE = re.compile(r"\\(?:input|include)\s*\{([^}]+)\}")
LABEL_RE = re.compile(r"\\label\s*\{([^}]+)\}")
LISTING_LABEL_RE = re.compile(r"\blabel\s*=\s*\{((?:fig|alg):[^{}]+)\}")
ATLAS_ID_RE = re.compile(r"^\|\s*`([IVX]+/(?:fig|alg):[^`]+)`\s*\|", re.MULTILINE)


@dataclass(frozen=True)
class SourceFigure:
    atlas_id: str
    source: Path


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


def walk_tex(root: Path) -> list[tuple[Path, str]]:
    """Return each recursively included TeX file once, in reading order."""

    visited: set[Path] = set()
    ordered: list[tuple[Path, str]] = []

    def visit(path: Path) -> None:
        resolved = path.resolve()
        if resolved in visited:
            return
        if not resolved.is_file():
            raise FileNotFoundError(f"included TeX source does not exist: {resolved}")
        visited.add(resolved)
        text = strip_tex_comments(resolved.read_text(encoding="utf-8"))
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


def extract_source_figures(repo_root: Path) -> list[SourceFigure]:
    figures: list[SourceFigure] = []
    for volume, relative_root in CANONICAL_ROOTS.items():
        root = (repo_root / relative_root).resolve()
        for source, text in walk_tex(root):
            for match in FIGURE_RE.finditer(text):
                label = figure_label(match.group(1), source)
                figures.append(SourceFigure(f"{volume}/{label}", source))
    return figures


def extract_atlas_ids(atlas: Path) -> list[str]:
    return ATLAS_ID_RE.findall(atlas.read_text(encoding="utf-8"))


def duplicates(values: Iterable[str]) -> list[str]:
    return sorted(value for value, count in Counter(values).items() if count > 1)


def compare(source_figures: list[SourceFigure], atlas_ids: list[str]) -> dict[str, object]:
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
    }


def is_clean(report: dict[str, object]) -> bool:
    return not any(
        report[key]
        for key in (
            "missing_from_atlas",
            "stale_in_atlas",
            "duplicate_source_ids",
            "duplicate_atlas_ids",
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
        source_figures = extract_source_figures(repo_root)
        atlas_ids = extract_atlas_ids(atlas)
        report = compare(source_figures, atlas_ids)
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
        ):
            values = report[key]
            if values:
                print(f"{key}:", file=sys.stderr)
                for value in values:
                    print(f"  - {value}", file=sys.stderr)
        print(
            f"source_count={report['source_count']} atlas_count={report['atlas_count']}",
            file=sys.stderr,
        )
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
