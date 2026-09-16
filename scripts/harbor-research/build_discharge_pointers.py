#!/usr/bin/env python3
"""build_discharge_pointers.py -- generate the Book's "proved on" pointer table.

The Book's theorem-discharge apparatus (whitepaper/textbook.json's per-chapter
`discharges` field: Chapter 2 and Chapter 3 discharge Chapter 1's promises,
Chapters 7 and 8 discharge Chapter 6's) tells the reader WHICH chapter proves
a promise, but never the page. `\\pdprovedon{label}` (figures/pd-pedagogy.tex)
closes that gap: placed beside a theorem/lemma/proposition in Chapter 1 or 6,
it renders a Book-only margin note pointing at wherever a later chapter
actually discharges it, and nothing at all in a standalone chapter build.

This script does NOT rediscover discharge pairs by any general heuristic --
chapters 2, 3, 7 and 8 restate and specialize Chapter 1 and 6's promises in
prose, not by re-using the same \\label, so there is no mechanical signal a
script can safely generalize from. Instead PAIRS below is a short, hand-
curated table, each entry commented with the textual evidence that justifies
it (grep-checkable in the cited file); the mechanical part this script
performs is verifying every label in that table still exists where claimed
(so a renamed or moved label fails the build loudly, per the task's "the
pointers regenerate when labels move" requirement) and namespacing every
target label to what scripts/generate-mega-whitepaper.mjs's namespaceLabels
will actually produce in the assembled Book (each chapter's own prefix from
whitepaper/textbook.json, prepended as "<prefix>:<label>").

A promise theorem this pass could not confidently pair with a discharging
chapter is not silently skipped -- see CANDIDATES_WITHOUT_A_MATCH below, and
the printed report -- rather than guessed at.

Usage:
    python3 scripts/harbor-research/build_discharge_pointers.py [--check]

Writes (byte-identical) whitepaper/figures/pd-discharges.tex and
website-v2/public/whitepaper/figures/pd-discharges.tex.

Exit status: 0 on a normal write; 1 if any curated label cannot be found (a
"regenerate when labels move" trip-wire) or --check finds the committed
copies stale.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEXTBOOK_REL = "whitepaper/textbook.json"

TARGETS = [
    "whitepaper/figures/pd-discharges.tex",
    "website-v2/public/whitepaper/figures/pd-discharges.tex",
]

LABEL_RE_TEMPLATE = r"\\label\{%s\}"

# ---------------------------------------------------------------------------
# The curated discharge table.
#
# Each entry: (promise_source, promise_label, target_source, target_label,
# kind, evidence). `kind` is "section" (renders "Proved in Sx.y") or "thm"
# (renders "Proved on p. N" -- used for a theorem/lemma/proposition/design
# invariant target, since those are not sections a reader would look up by
# number the way \S\ref works for a section).
#
# promise_source/target_source are whitepaper/textbook.json chapter ids
# (looked up below for their `source` path and `prefix`).
# ---------------------------------------------------------------------------
PAIRS = [
    (
        "single-writer-kernel", "thm:regimentation-controllability",
        "anchor-protocol", "sec:correct", "section",
        "anchor-protocol-whitepaper.tex \\S\\ref{sec:correct} (\"How we know it "
        "is correct\") states directly: \"The controllability theorem of "
        "[the Single-Writer Kernel] sorts every rule by whether the event it "
        "prohibits is one the mediator can refuse... every rule this chapter "
        "states... is regimentable, and the ProVerif models are proofs about "
        "a gate that really can close\" -- a concrete, mechanized discharge "
        "of the Kernel's abstract controllability theorem for the Anchor "
        "Protocol's card-verification gate.",
    ),
    (
        "harbor-economy", "prop:conservation",
        "bonded-commons", "thm:conservation", "thm",
        "harbor-economy.tex's Design Invariant \"Conservation\" "
        "(wallet+escrow+commons=supply) is marked \\Built with only a "
        "property-test check (\"verified across ten thousand random "
        "operation traces\"); agent-transactions-whitepaper.tex's Theorem "
        "\"Conservation\" (thm:conservation) proves the same invariant by "
        "induction over the same four operations (topUp/escrow/refund/"
        "slash) and is TLA+-mechanized per docs/harbor-research/"
        "library-index.json's unindexed_allow entry for this label.",
    ),
    # There used to be a third pair here, harbor-economy's thm:fh-escrow-bound
    # pointing at federated-harbor's thm:fh-escrow-bound, on the reasoning that
    # the two chapters' labels are namespaced apart in the Book and so did not
    # collide. They did not collide; they duplicated. Both chapters printed the
    # same conditional escrow bound under their own number, and the pointer
    # was a margin note on the first copy saying where the second was. Chapter
    # 6 no longer states the theorem in the Book (its \ifpdbook branch refers
    # to chapter 8's statement directly, and only the standalone paper keeps a
    # copy), so there is no promise for a pointer to hang on.
]

# Promise theorems this pass looked at and could NOT confidently pair with a
# discharging chapter from textual evidence alone -- recorded so the report
# is honest about what was considered and left alone, per the task's "report
# anything skipped." Every \pdchapref{swk}{...}/\pdchapref{he}{...} cross-
# reference found near these labels pointed FROM the discharging chapter back
# to Chapter 1/6 as a premise the discharging chapter's OWN proof leans on
# (e.g. sealed-harbor.tex \S\ref{...}: "the theorem is the controllability
# theorem of [Chapter 1]... this section only applies it") -- the reverse of
# a discharge -- rather than restating and proving a Chapter 1/6 promise.
CANDIDATES_WITHOUT_A_MATCH = [
    ("single-writer-kernel", "thm:exclusion",
     "Atomic Mutual Exclusion and Fenced Leases -- sealed-harbor.tex cites "
     "it as a premise (\"reduces to the sequential case by the "
     "linearizability of the single writer, which [Chapter 1] proves for "
     "exactly this setting\"), not as something it goes on to discharge."),
    ("single-writer-kernel", "thm:workunit",
     "Six invariants of the work-unit machine -- sealed-harbor.tex borrows "
     "the work-unit CONCEPT for its own case file (\"It is a work unit in "
     "the sense of [Chapter 1]\") rather than proving the Kernel's own "
     "invariants."),
    ("single-writer-kernel", "thm:consistency",
     "Conditional consistency model -- no discharging-chapter text found "
     "that restates or proves this specific claim; it is cited only as "
     "supporting context."),
    ("single-writer-kernel", "prop:durability",
     "Durability by fault class -- no reference to this property, by name "
     "or by its I1a/I1b vocabulary, found in anchor-protocol-whitepaper.tex "
     "or sealed-harbor.tex."),
]


def rel(path: str) -> str:
    return os.path.relpath(path, REPO_ROOT)


def load_textbook() -> dict:
    path = os.path.join(REPO_ROOT, TEXTBOOK_REL)
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def chapter_by_id(textbook: dict) -> dict[str, dict]:
    return {c["id"]: c for c in textbook["chapters"]}


def label_exists(source_rel: str, label: str) -> bool:
    path = os.path.join(REPO_ROOT, source_rel)
    if not os.path.isfile(path):
        return False
    with open(path, encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    return re.search(LABEL_RE_TEMPLATE % re.escape(label), text) is not None


HEADER = """% GENERATED by scripts/harbor-research/build_discharge_pointers.py from a
% hand-curated (label-existence checked) list of discharge pairs -- do not
% hand-edit. Regenerate with:
%   python3 scripts/harbor-research/build_discharge_pointers.py
%
% One \\pdprovedonentry{promise label}{namespaced target label}{section|thm}
% per discharge pair \\pdprovedon (figures/pd-pedagogy.tex) can point to. The
% target label is already namespaced as
% scripts/generate-mega-whitepaper.mjs's namespaceLabels will render it in
% the assembled Book ("<chapter prefix>:<local label>").
% Twin copy: whitepaper/figures/pd-discharges.tex and
% website-v2/public/whitepaper/figures/pd-discharges.tex are kept
% byte-identical by this script (both preambles \\input it via
% figures/pd-pedagogy.tex).
"""


def build() -> tuple[str, list[str]]:
    textbook = load_textbook()
    by_id = chapter_by_id(textbook)
    lines: list[str] = []
    errors: list[str] = []

    for promise_id, promise_label, target_id, target_label, kind, evidence in PAIRS:
        promise_chapter = by_id.get(promise_id)
        target_chapter = by_id.get(target_id)
        if promise_chapter is None:
            errors.append(f"unknown chapter id in PAIRS: {promise_id!r}")
            continue
        if target_chapter is None:
            errors.append(f"unknown chapter id in PAIRS: {target_id!r}")
            continue
        if kind not in ("section", "thm"):
            errors.append(f"{promise_id}/{promise_label}: unknown kind {kind!r}")
            continue
        if not label_exists(promise_chapter["source"], promise_label):
            errors.append(
                f"{promise_chapter['source']}: \\label{{{promise_label}}} not found "
                f"(the discharge table's promise side has drifted -- update PAIRS)"
            )
            continue
        if not label_exists(target_chapter["source"], target_label):
            errors.append(
                f"{target_chapter['source']}: \\label{{{target_label}}} not found "
                f"(the discharge table's target side has drifted -- update PAIRS)"
            )
            continue
        namespaced_target = f"{target_chapter['prefix']}:{target_label}"
        lines.append(f"\\pdprovedonentry{{{promise_label}}}{{{namespaced_target}}}{{{kind}}}")

    body = HEADER.rstrip("\n") + "\n\n" + "\n".join(lines) + ("\n" if lines else "")
    return body, errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="fail if the committed copies are stale; write nothing")
    args = parser.parse_args()

    rendered, errors = build()

    print(f"{len(PAIRS)} discharge pair(s) in the curated table, {len(errors)} label-existence failure(s)")
    for e in errors:
        print(f"  FAIL: {e}")
    if CANDIDATES_WITHOUT_A_MATCH:
        print(f"\n{len(CANDIDATES_WITHOUT_A_MATCH)} candidate promise(s) considered and left unpaired:")
        for chapter_id, label, reason in CANDIDATES_WITHOUT_A_MATCH:
            print(f"  {chapter_id}: {label} -- {reason}")

    if errors:
        print("\nrefusing to write a discharge table with a dangling label", file=sys.stderr)
        return 1

    if args.check:
        stale = []
        for target in TARGETS:
            path = os.path.join(REPO_ROOT, target)
            on_disk = None
            if os.path.isfile(path):
                with open(path, encoding="utf-8") as fh:
                    on_disk = fh.read()
            if on_disk != rendered:
                stale.append(target)
        if stale:
            print(f"\nSTALE: {', '.join(stale)} do not match a fresh render; run without --check", file=sys.stderr)
            return 1
        print("\nboth copies of pd-discharges.tex are up to date")
        return 0

    for target in TARGETS:
        path = os.path.join(REPO_ROOT, target)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(rendered)
        print(f"wrote {target} ({len(rendered)} bytes)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
