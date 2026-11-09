#!/usr/bin/env python3
"""render_status_tables.py -- a chapter's status table, from the manifest.

The chapters' verification-status tables (Tables 1.11, 1.14, 2.6, 4.15,
5.10, 7.9, 8.7 and A.2 in the reviewed build) are written by hand, so the
status word a chapter prints for an artifact can drift from the status the
proof-estate manifest, book/corpus.json, records for it. Table 7.9 still
says EasyCrypt "discharged" a binding whose model the manifest has retired.

This script renders, for any chapter, a LaTeX fragment listing every
manifest artifact the chapter names, with the status the manifest gives it.
A later wave \\inputs the fragment in place of a hand-written table. The
module is also the one place the two status vocabularies meet:
check_status_consistency.py imports it to report every artifact a chapter
names whose printed status word disagrees with the manifest.

Which artifacts a chapter names. The chapter's source and every file it
\\inputs are read with comments removed and inline markup unwrapped
(\\path{harbor_}\\allowbreak\\path{card_v*.pv} reads as harbor_card_v*.pv).
A token with a model or script extension (.pv .tla .cfg .ec .z3 .smt2 .lean
.thy .als .py .mjs .js .ts .rs) or a Kani harness name (proof_...) names an
artifact when it equals a manifest path, ends one at a path boundary, is a
basename or the tail of one after "_" or "-" ("ingress_origin_auth.pv"), or
matches one as a glob ("harbor_card_v*.pv"). Where a basename is ambiguous,
current entries are preferred over historical ones.

The manifest's status, in the Book's words (one axis per question):
    current, CI-wired, models shipped code     -> \\Closed
    current, CI-wired, a result script          -> \\Closed
    current, CI-wired, a design-level model     -> \\SpecOnly (no runtime tracked)
    partial, CI-wired                           -> \\Partial
    retired from CI, or historical              -> \\Open

Usage:
    python3 scripts/harbor-research/render_status_tables.py --chapter bonded
    python3 scripts/harbor-research/render_status_tables.py --chapter 7 --out FILE
    python3 scripts/harbor-research/render_status_tables.py --all --out-dir DIR

--chapter takes a chapter prefix, number or id from book/textbook.json, or
"prereq" (Chapter 0) or "appendices" (the volume appendices). --all writes
DIR/mega-volume-status-<prefix>.tex for every unit. The fragment is an
xltabular with its own caption and label (<prefix>:tab:manifest-status by
default; --caption and --label override them), and needs the Book's
preamble (booktabs, xltabular, url and the status markers).
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BOOK = REPO_ROOT / "book"
MANIFEST = BOOK / "corpus.json"
TEXTBOOK = BOOK / "textbook.json"
FOUNDATIONS = ("prereq", 0, "Foundations and Prerequisites", "book/coordination-papers-mega-volume-chapter-0.tex")
APPENDICES = ("appendices", None, "Volume appendices", "book/coordination-papers-mega-volume-appendices.tex")

EXTENSIONS = ("pv", "tla", "cfg", "ec", "z3", "smt2", "lean", "thy", "als", "py", "mjs", "js", "ts", "rs")
# Only these, unmatched, are worth reporting as "named but not registered":
# "Node.js" and "lib.rs" are names, not a missing manifest row.
UNREGISTERED_EXTENSIONS = ("pv", "tla", "ec", "z3", "smt2", "lean", "thy", "als", "py", "mjs")
TOKEN = re.compile(r"(?<![\w./*+-])([\w*][\w.*/+-]*\.(?:" + "|".join(EXTENSIONS) + r"))(?![\w])")
HARNESS = re.compile(r"(?<![\w])(proof_[a-z0-9_]+)(?![\w])")


# ---------------------------------------------------------------------------
# The manifest
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Artifact:
    id: str
    kind: str
    method: str
    status: str  # current | partial | historical
    ci_status: str  # wired | retired
    ci_detail: str  # the job list, or the retirement reason
    authority: str  # product-runtime | design-claim | "" (research artifacts)
    paths: tuple[str, ...]
    harness: str = ""

    @property
    def state(self) -> str:
        """The one evidence state the manifest records."""
        if self.ci_status == "retired":
            return "retired"
        if self.status == "historical":
            return "historical"
        return self.status  # current | partial

    @property
    def marker(self) -> str:
        """The manifest's status as a Book marker (see the module docstring)."""
        if self.state in ("retired", "historical"):
            return "Open"
        if self.state == "partial":
            return "Partial"
        return "SpecOnly" if self.authority == "design-claim" else "Closed"

    def describe(self) -> str:
        scope = {"product-runtime": "models shipped code", "design-claim": "design-level model",
                 "": "result script"}[self.authority]
        ci = f"CI {self.ci_detail}" if self.ci_status == "wired" else f"retired from CI ({self.ci_detail})"
        return f"{self.id}: {self.status}, {ci}" + (f", {scope}" if scope else "")


def load_manifest(path: Path = MANIFEST) -> list[Artifact]:
    data = json.loads(path.read_text(encoding="utf-8"))
    artifacts = []
    for section in ("formalArtifacts", "researchProgramArtifacts"):
        for row in data.get(section, []):
            ci = row["ci"]
            detail = ", ".join(ci["job"]) if ci["status"] == "wired" else ci.get("reason", "")
            artifacts.append(Artifact(
                id=row["id"], kind=row["kind"], method=row.get("method", row["kind"]),
                status=row["status"], ci_status=ci["status"], ci_detail=detail,
                authority=row.get("authority", ""), paths=tuple(row["paths"]),
                harness=row.get("harnessName", ""),
            ))
    return artifacts


def path_hit(token: str, path: str) -> str | None:
    """How `token` names `path`: "exact", "tail" (an abbreviation), or None."""
    base = path.rsplit("/", 1)[-1]
    if "*" in token:
        return "exact" if fnmatch.fnmatchcase(base, token) or fnmatch.fnmatchcase(path, token) else None
    if "/" in token:
        return "exact" if path == token or path.endswith("/" + token) else None
    if base == token:
        return "exact"
    if base.endswith(token) and base[-len(token) - 1] in "_-":
        return "tail"
    return None


def match_token(token: str, artifacts: list[Artifact]) -> list[Artifact]:
    """Every manifest artifact `token` names (rules in the module docstring)."""
    if token.startswith("proof_"):
        return [a for a in artifacts if a.harness == token]
    exact, tails = [], []
    for artifact in artifacts:
        hits = {path_hit(token, path) for path in artifact.paths}
        if "exact" in hits:
            exact.append(artifact)
        elif "tail" in hits:
            tails.append(artifact)
    # A tail match ("ingress_origin_auth.pv" for github_ingress_origin_auth.pv)
    # is the Book abbreviating a name; it never outranks a name printed whole
    # ("isolation.pv" is not github_ingress_tenant_isolation.pv).
    return exact or tails


def preferred(candidates: list[Artifact]) -> list[Artifact]:
    """For a table: drop historical entries when a live one shares the name."""
    live = [a for a in candidates if a.status != "historical"]
    return live or candidates


# ---------------------------------------------------------------------------
# The chapters
# ---------------------------------------------------------------------------


@dataclass
class Unit:
    prefix: str
    number: int | None
    title: str
    source: str
    files: list[Path] = field(default_factory=list)


def load_units(textbook: Path = TEXTBOOK) -> list[Unit]:
    data = json.loads(textbook.read_text(encoding="utf-8"))
    units = [Unit(*FOUNDATIONS)]
    for chapter in sorted(data["chapters"], key=lambda c: c["number"]):
        units.append(Unit(chapter["prefix"], chapter["number"], chapter["title"], chapter["source"]))
    units.append(Unit(*APPENDICES))
    for unit in units:
        unit.files = trace_inputs(REPO_ROOT / unit.source)
    return units


def find_unit(units: list[Unit], key: str, textbook: Path = TEXTBOOK) -> Unit:
    ids = {c["id"]: c["prefix"] for c in json.loads(textbook.read_text(encoding="utf-8"))["chapters"]}
    key = ids.get(key, key)
    for unit in units:
        if key == unit.prefix or (unit.number is not None and key == str(unit.number)):
            return unit
    raise SystemExit(f"render_status_tables: no chapter {key!r}; use a prefix, number or id from "
                     "book/textbook.json, or prereq or appendices")


def trace_inputs(entry: Path) -> list[Path]:
    """The file and everything it reaches through \\input / \\include."""
    seen: list[Path] = []

    def visit(path: Path) -> None:
        if path in seen or not path.is_file():
            return
        seen.append(path)
        for ref in re.findall(r"\\(?:input|include)\{([^}]+)\}", blank_comments(path.read_text(encoding="utf-8"))):
            name = ref if Path(ref).suffix else f"{ref}.tex"
            for candidate in (path.parent / name, BOOK / name):
                if candidate.is_file():
                    visit(candidate.resolve())
                    break

    visit(entry.resolve())
    return seen


def blank_comments(tex: str) -> str:
    out = list(tex)
    i = 0
    while i < len(out):
        if out[i] == "\\":
            i += 2
            continue
        if out[i] == "%":
            while i < len(out) and out[i] != "\n":
                out[i] = " "
                i += 1
        i += 1
    return "".join(out)


UNWRAP = ("path", "texttt", "code", "url", "nolinkurl", "textsf", "emph", "textit", "textbf",
          "textsc", "textrm", "mbox", "hbox", "small", "footnotesize")
DROP = ("allowbreak", "linebreak", "nobreak", "newline", "break", "protect")
ESCAPED = {"_": "_", "&": "&", "%": "%", "#": "#", "$": "$", "-": "", ",": " ", " ": " ", "/": ""}


def unwrap_markup(tex: str) -> tuple[str, list[int]]:
    """`tex` with comments blank, inline markup unwrapped and braces gone, so
    a path split across \\path{...}\\allowbreak\\path{...} reads whole. Status
    macros (\\Closed, \\Designed, ...) survive. Returns the text and, per
    character, its offset in `tex`."""
    text = blank_comments(tex)
    out: list[str] = []
    origin: list[int] = []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch == "\\" and text.startswith("\\\\", i):
            out.extend("\\\\")  # a row separator: the table reader splits on it
            origin.extend((i, i + 1))
            i += 2
            continue
        if ch == "\\":
            m = re.match(r"\\([A-Za-z@]+)\*?", text[i:])
            if m:
                name = m.group(1)
                if name in UNWRAP or name in DROP:
                    i += m.end()
                    continue
                # Kept verbatim, then a space, so the macro cannot fuse with
                # the word its dropped braces held: \Closed{}pinned.
                out.extend(m.group(0) + " ")
                origin.extend([*range(i, i + m.end()), i + m.end() - 1])
                i += m.end()
                continue
            if i + 1 < n and text[i + 1] in ESCAPED:
                for c in ESCAPED[text[i + 1]]:
                    out.append(c)
                    origin.append(i)
                i += 2
                continue
            out.append(ch)
            origin.append(i)
            i += 1
            continue
        if ch in "{}":
            i += 1
            continue
        out.append(" " if ch == "~" else ch)
        origin.append(i)
        i += 1
    return "".join(out), origin


@dataclass
class Mention:
    unit: Unit
    file: Path
    line: int
    token: str
    candidates: list[Artifact]
    context: str  # the table row, or the sentence, as unwrapped text
    in_table: bool


# In unwrapped text the braces are gone: \begin{xltabular} reads "\begin xltabular".
TABLE_ENVS = re.compile(
    r"\\begin (xltabular|tabularx|tabulary|longtable|tabular\*?)(?![A-Za-z])(.*?)\\end \1(?![A-Za-z])", re.S)


def contexts(text: str) -> list[tuple[int, int, bool]]:
    """Spans of table rows (in_table=True) in unwrapped text; everything else
    is prose, read a sentence at a time."""
    rows = []
    for env in TABLE_ENVS.finditer(text):
        start = env.start(2)
        for piece in re.split(r"(\\\\(?:\[[^\]]*\])?)", env.group(2)):
            end = start + len(piece)
            if not piece.startswith("\\\\"):
                rows.append((start, end, True))
            start = end
    return rows


SENTENCE_END = re.compile(r"[.!?](?=\s)|\n\s*\n|\\begin |\\end ")


def sentence_around(text: str, at: int) -> tuple[int, int]:
    """The sentence holding offset `at`: it ends at a full stop before
    whitespace, a blank line, or an environment boundary, so a sentence
    never runs into the table beside it."""
    left = 0
    for m in SENTENCE_END.finditer(text, 0, at):
        left = m.end()
    m = SENTENCE_END.search(text, at)
    return left, (m.start() if m else len(text))


def mentions(units: list[Unit], artifacts: list[Artifact]) -> tuple[list[Mention], list[Mention]]:
    """Every manifest artifact each unit names, and every artifact-like token
    that names nothing in the manifest."""
    named: list[Mention] = []
    unregistered: list[Mention] = []
    seen: set[tuple[str, int, str]] = set()
    for unit in units:
        for path in unit.files:
            raw = path.read_text(encoding="utf-8")
            text, origin = unwrap_markup(raw)
            rows = contexts(text)
            for pattern in (TOKEN, HARNESS):
                for m in pattern.finditer(text):
                    token = m.group(1)
                    line = raw.count("\n", 0, origin[m.start(1)]) + 1
                    key = (str(path), line, token)
                    if key in seen:
                        continue
                    seen.add(key)
                    row = next(((s, e) for s, e, _ in rows if s <= m.start(1) < e), None)
                    start, end = row if row else sentence_around(text, m.start(1))
                    context = re.sub(r"\s+", " ", text[start:end]).strip()
                    candidates = match_token(token, artifacts)
                    mention = Mention(unit, path, line, token, candidates, context, row is not None)
                    if candidates:
                        named.append(mention)
                    elif pattern is TOKEN and token.rsplit(".", 1)[-1] in UNREGISTERED_EXTENSIONS:
                        unregistered.append(mention)
    return named, unregistered


def named_rows(unit: Unit, named: list[Mention]) -> list[tuple[Artifact, tuple[str, ...]]]:
    """The artifacts `unit` names, each with the paths of it the unit names."""
    chosen: dict[str, tuple[Artifact, set[str]]] = {}
    for mention in named:
        if mention.unit is not unit:
            continue
        for artifact in preferred(mention.candidates):
            paths = chosen.setdefault(artifact.id, (artifact, set()))[1]
            paths.update(p for p in artifact.paths if path_hit(mention.token, p))
    rows = [(a, tuple(p for p in a.paths if p in paths) or a.paths[:1]) for a, paths in chosen.values()]
    return sorted(rows, key=lambda row: (row[0].method.lower(), row[1][0], row[0].harness))


def artifacts_named(unit: Unit, named: list[Mention]) -> list[Artifact]:
    return [artifact for artifact, _ in named_rows(unit, named)]


# ---------------------------------------------------------------------------
# The fragment
# ---------------------------------------------------------------------------


def tex_text(text: str) -> str:
    replacements = {"\\": r"\textbackslash{}", "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#",
                    "_": r"\_", "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}", "^": r"\textasciicircum{}"}
    return "".join(replacements.get(c, c) for c in text)


def short_reason(reason: str, limit: int = 150) -> str:
    first = re.split(r"(?<=[.;])\s", reason.strip(), maxsplit=1)[0].rstrip(".;")
    return first if len(first) <= limit else first[: limit - 1].rstrip() + "\u2026"


def status_cell(artifact: Artifact) -> str:
    if artifact.marker == "Open":
        return rf"\Open{{}} {artifact.state}"
    if artifact.marker == "Partial":
        return r"\Partial{} partial"
    scope = {"product-runtime": "models shipped code", "design-claim": "design-level model",
             "": "result script"}[artifact.authority]
    return rf"\{artifact.marker}{{}} current; {scope}"


def ci_cell(artifact: Artifact) -> str:
    if artifact.ci_status == "wired":
        jobs = ", ".join(rf"\path{{{job.strip()}}}" for job in artifact.ci_detail.split(","))
        return f"run by {jobs}"
    return f"retired: {tex_text(short_reason(artifact.ci_detail))}"


def artifact_cell(artifact: Artifact, paths: tuple[str, ...]) -> str:
    cells = r"\newline{}".join(rf"\path{{{p}}}" for p in paths[:3])
    if len(paths) > 3:
        cells += rf"\newline{{}}and {len(paths) - 3} more it names"
    if artifact.harness:
        cells += rf"\newline{{}}harness \path{{{artifact.harness}}}"
    if len(artifact.paths) > len(paths) and not artifact.harness:
        cells += rf"\newline{{}}({len(artifact.paths)} files in \path{{{artifact.id}}})"
    return cells


def render(unit: Unit, rows: list[tuple[Artifact, tuple[str, ...]]], caption: str | None = None,
           label: str | None = None) -> str:
    where = f"Chapter {unit.number}, {unit.title}" if unit.number is not None else unit.title
    label = label or f"{unit.prefix}:tab:manifest-status"
    caption = caption or (
        "Every artifact this chapter names, with the status the proof-estate manifest "
        r"(\texttt{book/corpus.json}) records for it. \Closed: current, run in CI, and modelling "
        r"shipped code or computing a result. \SpecOnly: current and run in CI, but a design-level model with no "
        r"runtime tracked. \Partial: partial evidence. \Open: retired from CI or historical. "
        r"Appendix~\ref{app:mechanized} gives each artifact's evidence policy."
    )
    header = r"\textbf{Artifact} & \textbf{Method} & \textbf{Status} & \textbf{Checked} \\"
    lines = [
        "% GENERATED by scripts/harbor-research/render_status_tables.py from book/corpus.json.",
        f"% {where}: every manifest artifact the chapter names. Do not edit by hand;",
        "% the build regenerates this file, so the table cannot drift from the manifest.",
        r"{\footnotesize",
        r"\setlength{\tabcolsep}{4pt}",
        # A path may break after any separator, not only "/": a model's name
        # is often one long underscored word.
        r"\def\UrlBreaks{\do\/\do\_\do\-\do\.}",
        # \hspace{0pt} lets TeX hyphenate a cell's first word ("deterministic").
        r"\begin{xltabular}{\textwidth}{@{}>{\raggedright\arraybackslash}p{0.31\textwidth} "
        + r">{\raggedright\arraybackslash\hspace{0pt}}p{0.16\textwidth} "
        + r">{\raggedright\arraybackslash\hspace{0pt}}p{0.19\textwidth} "
        + r">{\raggedright\arraybackslash\hspace{0pt}}X@{}}",
        rf"\caption{{{caption}}}\label{{{label}}}\\",
        r"\toprule", header, r"\midrule", r"\endfirsthead",
        r"\multicolumn{4}{@{}l}{\small\itshape (continued)}\\",
        r"\toprule", header, r"\midrule", r"\endhead",
        r"\bottomrule", r"\endfoot", r"\bottomrule", r"\endlastfoot",
    ]
    if not rows:
        lines.append(r"\multicolumn{4}{@{}l}{\itshape This chapter names no artifact in the manifest.}\\")
    for artifact, paths in rows:
        lines.append(f"{artifact_cell(artifact, paths)} & {tex_text(artifact.method.replace('-', ' '))} & "
                     f"{status_cell(artifact)} & {ci_cell(artifact)} \\\\")
    lines += [r"\end{xltabular}}", ""]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    which = parser.add_mutually_exclusive_group(required=True)
    which.add_argument("--chapter", help="a chapter prefix, number or id, or prereq or appendices")
    which.add_argument("--all", action="store_true", help="every unit, into --out-dir")
    parser.add_argument("--out", type=Path, help="write the fragment here (default: stdout)")
    parser.add_argument("--out-dir", type=Path, help="with --all: write mega-volume-status-<prefix>.tex here")
    parser.add_argument("--caption", help="replace the default caption (TeX)")
    parser.add_argument("--label", help="replace the default label")
    parser.add_argument("--manifest", type=Path, default=MANIFEST, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    artifacts = load_manifest(args.manifest)
    units = load_units()
    named, _ = mentions(units, artifacts)
    if args.all:
        if not args.out_dir:
            parser.error("--all needs --out-dir")
        args.out_dir.mkdir(parents=True, exist_ok=True)
        for unit in units:
            target = args.out_dir / f"mega-volume-status-{unit.prefix}.tex"
            target.write_text(render(unit, named_rows(unit, named)), encoding="utf-8")
        print(f"render_status_tables: wrote {len(units)} status table(s) to {args.out_dir}")
        return 0
    unit = find_unit(units, args.chapter)
    fragment = render(unit, named_rows(unit, named), args.caption, args.label)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(fragment, encoding="utf-8")
    else:
        sys.stdout.write(fragment)
    return 0


if __name__ == "__main__":
    sys.exit(main())
