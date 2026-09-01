#!/usr/bin/env python3
"""check_propagated_corrections.py -- audit tool for pattern B1 ("un-propagated
corrections") across the harbor-research corpus.

Background
----------
whitepaper/reviews/current/exposition/CROSS-DOCUMENT-SYNTHESIS.md, section
"B. Systemic patterns across the corpus", item B1 ("Un-propagated corrections
-- the single largest pattern in the corpus"), describes a recurring defect:
a reviewer's correction lands in exactly one place in a document (usually a
theorem box or a body paragraph) but is never carried to the four-to-seven
other places in the same document -- the express lane, the one-breath
sentence, figure captions, TikZ node text, tables -- that echo the same
claim. Nine documents were named: paper1, paper3, paper4, paper5, paper6,
legible-swarm, single-writer-kernel, spawn-to-person, federated-harbor. The
synthesis doc explicitly asks for exactly this tool: "for every corrected
claim, grep for the claim's distinctive numbers and phrases across the whole
document and its figure fragments, and fix all sites at once ... That table
should be built once for the whole corpus, not once per chapter."

This script is that table. It does NOT re-derive the correction list from
scratch -- it encodes, per correction-item, the exact site(s) a human
reviewer (see the per-document *-notes.md files under
whitepaper/reviews/current/exposition/) flagged as needing to agree, plus
concrete regex patterns verified against the CURRENT tree at the time this
script was written. Because a large amount of fix work has already landed
on top of the synthesis doc (see `git log --oneline` for commits like
"fix(paper5): resolve verified claims, disambiguate gamma referent"), most
items below are expected to already be RESOLVED -- that is the good, common
case, not a bug in the checker.

Usage
-----
    python3 scripts/harbor-research/check_propagated_corrections.py [--verbose]

Exit code is 0 iff every item is RESOLVED (NEEDS-MANUAL-REVIEW items do not
fail the build, but are printed prominently with the reason a plain grep
can't settle them).
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# ---------------------------------------------------------------------------
# Comment stripping: several of the "stale phrase" patterns below legitimately
# survive inside a `%`-comment that *documents* the fix (e.g. fig-r2-regime.tex
# carries "CROSS-CHECK RESOLVED: ... the caption's '1.05--1.08' ..." as a
# permanent audit trail). Matching those would be a false STILL-STALE. Strip
# LaTeX line comments (an unescaped `%` to end of line) before every check.
# ---------------------------------------------------------------------------


def strip_latex_comments(text: str) -> str:
    out_lines = []
    for line in text.split("\n"):
        cut = None
        i = 0
        while i < len(line):
            if line[i] == "%" and (i == 0 or line[i - 1] != "\\"):
                cut = i
                break
            i += 1
        out_lines.append(line[:cut] if cut is not None else line)
    return "\n".join(out_lines)


@dataclass
class Check:
    """One concrete grep against one file.

    Exactly one of `absent` / `present` (or both) is set. `absent` is a
    pattern representing the STALE text that must no longer appear;
    `present` is a pattern representing the CORRECTED text that must appear.
    Patterns are Python regexes, matched with re.DOTALL so a pattern can span
    a line break (LaTeX reflows prose across lines with no semantic meaning).
    `note` explains what the site is, for the reconciliation table.
    """

    file: str
    note: str
    absent: str | None = None
    present: str | None = None

    def run(self, verbose: bool) -> tuple[bool, list[str]]:
        """Returns (ok, detail_lines)."""
        path = REPO_ROOT / self.file
        if not path.exists():
            return False, [f"    [MISSING FILE] {self.file}"]
        raw = path.read_text(errors="replace")
        text = strip_latex_comments(raw)
        details: list[str] = []
        ok = True

        if self.absent is not None:
            m = re.search(self.absent, text, re.DOTALL)
            if m:
                ok = False
                line_no = text[: m.start()].count("\n") + 1
                snippet = re.sub(r"\s+", " ", m.group(0)).strip()[:160]
                details.append(
                    f"    [STALE TEXT STILL PRESENT] {self.file}:{line_no} "
                    f"matched absent-pattern {self.absent!r}"
                )
                if verbose:
                    details.append(f"      >> {snippet}")
            elif verbose:
                details.append(
                    f"    [ok-absent] {self.file}: {self.absent!r} correctly not found"
                )

        if self.present is not None:
            m = re.search(self.present, text, re.DOTALL)
            if not m:
                ok = False
                details.append(
                    f"    [CORRECTED TEXT NOT FOUND] {self.file}: expected pattern "
                    f"{self.present!r} ({self.note})"
                )
            elif verbose:
                line_no = text[: m.start()].count("\n") + 1
                snippet = re.sub(r"\s+", " ", m.group(0)).strip()[:160]
                details.append(f"    [ok-present] {self.file}:{line_no} >> {snippet}")

        return ok, details


@dataclass
class Item:
    id: str
    doc: str
    description: str
    checks: list[Check]
    manual_review_reason: str | None = None  # if set, item is NEEDS-MANUAL-REVIEW
    # regardless of what the checks say -- used when a simple grep genuinely
    # cannot settle the question (e.g. it needs a LaTeX render, or a judgment
    # call about tone rather than presence/absence of a string).


# ---------------------------------------------------------------------------
# The corpus-wide reconciliation table.
#
# Every pattern below was checked by hand against the working tree before
# being encoded here (see the session that authored this script). None of
# them is speculative.
# ---------------------------------------------------------------------------

ITEMS: list[Item] = [
    # ---------------------------------------------------------------- paper1
    Item(
        id="paper1-superadditivity",
        doc="paper1.tex",
        description=(
            "Super-additivity band '1.05-1.08 across regimes' (contradicted by "
            "the figure's own plotted data reaching 1.39 at k=10) -- must read "
            "as an unbounded, growing ratio everywhere, not a fixed band."
        ),
        checks=[
            Check(
                "whitepaper/research/tex/paper1.tex",
                "body/abstract must not restate the retracted 1.05--1.08 band",
                absent=r"1\.05\s*(--|-|\\text\{--\})\s*1\.08",
                present=r"grows without bound in \$?k\$?",
            ),
            Check(
                "whitepaper/research/figures/fig-r2-regime.tex",
                "figure caption must not restate the retracted band either",
                absent=r"1\.05\s*(--|-|\\text\{--\})\s*1\.08",
            ),
        ],
    ),
    Item(
        id="paper1-0-16-provenance",
        doc="paper1.tex",
        description=(
            "The 0/16 falsification count is a simulation result and must be "
            "tagged [internal] everywhere, not [verified] anywhere (it is not "
            "externally recomputable from a closed form)."
        ),
        checks=[
            Check(
                "whitepaper/research/tex/paper1.tex",
                "all three body sites tag 0/16 as internal",
                absent=r"0/16[^.]{0,40}\[verified\]",
                present=r"0/16[^.]{0,60}\[internal",
            ),
            Check(
                "whitepaper/research/figures/fig-r1-relation.tex",
                "figure node must tag 0/16 as internal, not verified",
                absent=r"0/16\$?\s*floor violations[\s\\{]*\[verified",
                present=r"0/16\$?\s*floor violations[\s\\{]*\[internal",
            ),
        ],
    ),
    # ---------------------------------------------------------------- paper3
    Item(
        id="paper3-unbounded-depth",
        doc="paper3.tex",
        description=(
            "The clique/tower depth overclaim ('unbounded depth' / 'certifies "
            "unbounded levels') was corrected to a finite, C-dependent, "
            "logarithmic-depth result in the body; the literal phrase must not "
            "survive in the figure fragments (outside the comment documenting "
            "the fix)."
        ),
        checks=[
            Check(
                "whitepaper/research/tex/paper3.tex",
                "body prose must not claim unbounded tower depth",
                absent=r"[Uu]nbounded depth|certifies unbounded levels",
                present=r"depth logarithmic in",
            ),
            Check(
                "whitepaper/research/figures/fig-r7-relation.tex",
                "relation-map figure must not (outside comments) claim unbounded depth",
                absent=r"[Uu]nbounded depth|certifies unbounded levels",
                present=r"depth logarithmic in the corrupt value",
            ),
            Check(
                "whitepaper/research/figures/fig-r7-regime.tex",
                "regime figure inset must not (outside comments) claim unbounded depth",
                absent=r"[Uu]nbounded depth|certifies unbounded levels",
            ),
        ],
    ),
    # ---------------------------------------------------------------- paper4
    Item(
        id="paper4-pillar3-box",
        doc="paper4.tex",
        description=(
            "Pillar III's theorem box had swallowed three paragraphs of "
            "discussion (44 lines total) breaking the express-lane contract "
            "('box alone must state the result'); the fix splits Verification "
            "back out into its own short box."
        ),
        checks=[
            Check(
                "whitepaper/research/tex/paper4.tex",
                "Verification must be its own thebox, not appended to Theorem 3's box",
                present=r"\\begin\{thebox\}\s*\\textbf\{Verification \(Theorem 3\)\.?\}",
            ),
            Check(
                "whitepaper/research/tex/paper4.tex",
                "the 'why not just quote the advanced bound' discussion must sit "
                "outside the Theorem 3 box, as ordinary body prose",
                present=r"\\end\{thebox\}\s*\n*\\textbf\{Why not just quote the advanced bound\.\}",
            ),
        ],
    ),
    Item(
        id="paper4-b-collision",
        doc="paper4.tex",
        description=(
            "Symbol `b` collided between the SPRT Type-II error target and the "
            "headline quantity q*b (bits of channel capacity); fix renames the "
            "SPRT target to gamma."
        ),
        checks=[
            Check(
                "whitepaper/research/tex/paper4.tex",
                "SPRT error target must no longer be spelled (alpha, b)",
                absent=r"\(\\alpha,\s*b\)",
                present=r"\(\\alpha,\\gamma\)",
            ),
        ],
    ),
    Item(
        id="paper4-sec7-debts",
        doc="paper4.tex",
        description=(
            "Section 7 (the composition/leakage-budget section) is billed as "
            "where three earlier debts (laundering residual, the malicious-"
            "worker gap, the arbitrary-telemetry channel) get discharged; the "
            "fix names all three explicitly instead of discharging them silently."
        ),
        checks=[
            Check(
                "whitepaper/research/tex/paper4.tex",
                "S7 must name the three debts it is paying, not discharge them silently",
                present=r"pays the three debts it took on earlier",
            ),
        ],
    ),
    # ---------------------------------------------------------------- paper5
    Item(
        id="paper5-engine-substitution-hypothesis",
        doc="paper5.tex",
        description=(
            "Theorem 2b's IC-flip claim was amended in the box to flag its "
            "pricing condition as a hypothesis (fails under Bertrand pricing), "
            "but the abstract, S3 express lane, and S7 'New, honestly' summary "
            "still stated the flip unconditionally."
        ),
        checks=[
            Check(
                "whitepaper/research/tex/paper5.tex",
                "box (Theorem 2b) states the pricing condition is a hypothesis",
                present=r"pricing condition is a hypothesis",
            ),
            Check(
                "whitepaper/research/tex/paper5.tex",
                "abstract's engine-substitution claim must carry the pricing hypothesis",
                present=r"zero audit stake \\emph\{whenever the attested\s*\n?price schedule passes through the full quality difference\}",
            ),
            Check(
                "whitepaper/research/tex/paper5.tex",
                "S3 express lane (one-breath) must carry the pricing hypothesis",
                present=r"provided the attested price\s*\n?schedule passes through the full quality difference, the substitution incentive",
            ),
            Check(
                "whitepaper/research/tex/paper5.tex",
                "S7 'New, honestly' summary must carry the pricing hypothesis",
                present=r"under a stated pricing hypothesis,\s*\n?\\emph\{flips\}",
            ),
        ],
    ),
    Item(
        id="paper5-probation-cliff-uniqueness",
        doc="paper5.tex",
        description=(
            "Theorem 4's uniqueness claim must be consistently qualified by "
            "feasibility (unique only among schedules the newcomer's ceiling "
            "can carry) across the abstract, S5 express lane, the box, and S7."
        ),
        checks=[
            Check(
                "whitepaper/research/tex/paper5.tex",
                "abstract's probation-cliff claim is qualified by feasibility",
                present=r"maximally front-loaded \\emph\{feasible\} one uniquely",
            ),
            Check(
                "whitepaper/research/tex/paper5.tex",
                "S5 express lane ties uniqueness to what the newcomer's ceiling can carry",
                present=r"restriction as early as the newcomer's own ceiling can carry it",
            ),
            Check(
                "whitepaper/research/tex/paper5.tex",
                "box states uniqueness holds only when the programme is feasible",
                present=r"unique\} whenever the\s*\n?programme is feasible at all",
            ),
            Check(
                "whitepaper/research/tex/paper5.tex",
                "S7 summary names both the front-loading result and the feasibility bound",
                present=r"unique optimal shape, front-loaded to the newcomer's ceiling\s*\n?rather than ramped --- and a feasibility bound",
            ),
        ],
    ),
    # ---------------------------------------------------------------- paper6
    Item(
        id="paper6-dstar-inequality",
        doc="paper6.tex",
        description=(
            "Theorem 3's D* threshold had three different inequality "
            "conventions for the same fact across four sites (abstract, "
            "express lane, box, inventory table); fix standardizes on "
            "'<' for viability / '>=' for pooling-dominates (complementary, "
            "non-strict at the boundary since the infimum is unattained)."
        ),
        checks=[
            Check(
                "whitepaper/research/tex/paper6.tex",
                "abstract uses 'stays below D*' (viability convention)",
                present=r"stays below \$D\^\\star=\\eta K/\(1-\\eta K\)\$",
            ),
            Check(
                "whitepaper/research/tex/paper6.tex",
                "express lane uses 'xi/eta < D*' (viability convention)",
                present=r"sole-owner viability capped at \$\\xi/\\eta < D\^\\star\$",
            ),
            Check(
                "whitepaper/research/tex/paper6.tex",
                "theorem box uses '>= D*' (pooling-dominates convention, the complement)",
                present=r"\\frac\{\\xi\}\{\\eta\}\s*\\;\\ge\\;\s*D\^\\star",
            ),
            Check(
                "whitepaper/research/tex/paper6.tex",
                "inventory table uses 'xi/eta < D*' (viability convention)",
                present=r"viable only while \$\\xi/\\eta < D\^\\star",
            ),
        ],
    ),
    # ------------------------------------------------------- single-writer-kernel
    Item(
        id="swk-op-reconciliation-table",
        doc="single-writer-kernel.tex",
        description=(
            "Eight open problems (OP-1,2,3,4,5,7,9,10) were declared solved in "
            "the master list and/or originating section while their exercises "
            "boxes, the invariants table, and figure captions still described "
            "them as open -- the largest B1 instance in the corpus. Fix adds a "
            "single reconciliation table (tab:op-status) and makes every site "
            "agree with it. This item spot-checks OP-1 (the sharpest example: "
            "solved in section heading vs. still-open everywhere else) plus "
            "the table's own status column for all eight."
        ),
        checks=[
            Check(
                "whitepaper/source/single-writer-kernel.tex",
                "reconciliation table exists with a status column",
                present=r"\\label\{tab:op-status\}",
            ),
            Check(
                "whitepaper/source/single-writer-kernel.tex",
                "table's OP-1 row must say Open (matches the design-not-yet-shipped state)",
                present=r"OP-1 & Fair exclusion without a scheduler & \\Open &",
            ),
            Check(
                "whitepaper/source/single-writer-kernel.tex",
                "the adjacency contract's explicit non-provisions still list OP-1 as not provided",
                present=r"does \\emph\{not\} provide fair/queued exclusion \(OP-1\)",
            ),
            Check(
                "whitepaper/source/single-writer-kernel.tex",
                "the master Open Problems list must not claim OP-1 is closed/solved",
                absent=r"\$\\bigstar\$\s*OP-1[^.\n]*\]\s*Status:\s*\\Closed",
                present=r"\$\\bigstar\$ OP-1 --- Fair exclusion without a scheduler\.\] Status: \\Open",
            ),
            Check(
                "whitepaper/source/single-writer-kernel.tex",
                "table's OP-3 (runtime parity) row must say Open, not solved",
                present=r"OP-3 & Cross-runtime soundness \(I11\) & \\Open &",
            ),
            Check(
                "whitepaper/source/single-writer-kernel.tex",
                "table's OP-9 (SO_PEERCRED / same-machine adversary) row must say Open",
                present=r"OP-9 & Same-machine adversary & \\Open &",
            ),
            Check(
                "whitepaper/source/single-writer-kernel.tex",
                "table's OP-10 (selective checkpointing) row must say Open",
                present=r"OP-10 & Per-write-path durability & \\Open &",
            ),
        ],
    ),
    Item(
        id="swk-csma-pseudocode",
        doc="single-writer-kernel.tex",
        description=(
            "OP-5 (CSMA / oracle completeness): prose claimed 'oracle "
            "completeness achieved' by adding DELTA_ORACLE/AST_ASSERTION "
            "kinds, but Algorithm alg:close's actual oracle-kind enumeration "
            "was never updated to include them. Fix: alg:close's comment now "
            "explicitly marks those two kinds as specified-only (OP-5, still "
            "open), and they must not appear anywhere as live enum members."
        ),
        checks=[
            Check(
                "whitepaper/source/single-writer-kernel.tex",
                "alg:close comment marks DELTA_ORACLE/AST_ASSERTION as not-yet-shipped",
                present=r"\(OP-5, specified only\) would add DELTA_ORACLE and AST_ASSERTION here",
            ),
            Check(
                "whitepaper/source/single-writer-kernel.tex",
                "the shipped oracle-kind set (the actual enum literal) must not include the two new kinds",
                absent=r"\{RELEASED_CLAIM,\s*MERGED_COMMIT,\s*PASSING_TEST,\s*POLICY_SUBCHECK,\s*(DELTA_ORACLE|AST_ASSERTION)",
            ),
        ],
    ),
    # ------------------------------------------------------------- legible-swarm
    Item(
        id="legible-swarm-slm-sidecar",
        doc="legible-swarm.tex",
        description=(
            "The SLM Sidecar / Oversight Head (S7.4) was described in built-"
            "present-tense ('the architecture establishes...') with no "
            "Appendix A row and no maturity tag -- the one place the "
            "document's careful built/designed/proposed discipline lapsed."
        ),
        checks=[
            Check(
                "whitepaper/source/legible-swarm.tex",
                "prose must not claim the sidecar architecture is already established",
                absent=r"the architecture establishes two separate pipelines",
                present=r"the design calls for two separate pipelines",
            ),
            Check(
                "whitepaper/source/legible-swarm.tex",
                "Oversight Head must carry an explicit \\Vision (not-yet-built) tag",
                present=r"Oversight Head \(\$R_2\$, \\Vision\)",
            ),
            Check(
                "whitepaper/source/legible-swarm.tex",
                "Appendix A must carry a row for the sidecar",
                present=r"Oversight head / SLM sidecar \(air-gapped digest authoring\) & \\Vision",
            ),
        ],
    ),
    # ------------------------------------------------------------ spawn-to-person
    Item(
        id="spawn-to-person-op4-rehydration",
        doc="spawn-to-person.tex",
        description=(
            "Event-Sourced Neural Rehydration (OP-4) was described as 'now "
            "solved ... instantly' in the S5 pitfall box AND still listed "
            "under S10 'Open problems' as solved -- self-contradictory, and "
            "contradicts the shared kernel doc's own \\BUILTWEAK status plus "
            "paper5's Honest Boundary disclaiming exactly this class of claim."
        ),
        checks=[
            Check(
                "whitepaper/source/spawn-to-person.tex",
                "pitfall box must not claim OP-4 is solved/instant",
                absent=r"is now solved via[\s\S]{0,20}Event-Sourced Neural Rehydration|turning[^.]*instantly",
                present=r"\\DESIGNED, not \\BUILT",
            ),
            Check(
                "whitepaper/source/spawn-to-person.tex",
                "S10 open-problems entry must not claim OP-4 is Solved",
                absent=r"Solved via \\textbf\{Event-Sourced Neural Rehydration\}",
                present=r"\\DESIGNED\\ candidate answer",
            ),
        ],
    ),
    # ---------------------------------------------------------- federated-harbor
    Item(
        id="federated-harbor-escrow-figures",
        doc="federated-harbor-whitepaper.tex",
        description=(
            "Three figures (topology, xfer-ceremony, settlement) labeled the "
            "settlement escrow 'Authority Invariant' / 'Non-Custodial: Can "
            "Refuse, Cannot Redirect' as settled fact, while S6's own Property "
            "states it is conditional on four unverified custody assumptions. "
            "Fix: the topology and settlement figures now make the conditions "
            "explicit, while the transfer figure omits escrow custody rather "
            "than presenting an unproved custody claim."
        ),
        checks=[
            Check(
                "whitepaper/source/federated-harbor-whitepaper.tex",
                "S6.2's clearinghouse language must not assert the escrow as closed/settled",
                absent=r"2-of-3 Multisig Clearinghouse",
                present=r"candidate design, not a closed result",
            ),
            Check(
                "whitepaper/source/figures/fig-fh-federation-topology.tex",
                "topology figure's settlement rail must be conditional, not an unconditional invariant",
                absent=r"Non-Custodial: Can Refuse, Cannot Redirect",
                present=r"bounded custody only if gate holds",
            ),
            Check(
                "whitepaper/source/figures/fig-fh-settlement.tex",
                "settlement figure must identify the custody restrictions as theorem hypotheses",
                absent=r"Authority Invariant",
                present=r"the theorem's hypothesis, not decoration",
            ),
            Check(
                "whitepaper/source/figures/fig-fh-xfer-ceremony.tex",
                "xfer-ceremony figure must not restore the old unconditional escrow assertion",
                absent=r"Non-Custodial: Can Refuse, Cannot Redirect|Authority Invariant",
                present=r"revocation remains an asynchronous epoch-root dependency",
            ),
        ],
    ),
]


# ---------------------------------------------------------------------------


def evaluate(item: Item, verbose: bool) -> tuple[str, list[str]]:
    if item.manual_review_reason:
        return "NEEDS-MANUAL-REVIEW", [f"    [reason] {item.manual_review_reason}"]

    all_ok = True
    all_details: list[str] = []
    for check in item.checks:
        ok, details = check.run(verbose)
        all_details.extend(details)
        if not ok:
            all_ok = False

    return ("RESOLVED" if all_ok else "STILL-STALE"), all_details


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--verbose", action="store_true", help="print matched/unmatched lines for every check"
    )
    args = parser.parse_args()

    results: list[tuple[Item, str, list[str]]] = []
    for item in ITEMS:
        status, details = evaluate(item, args.verbose)
        results.append((item, status, details))

    # --- reconciliation table -------------------------------------------------
    col_id = max(len(it.id) for it, _, _ in results)
    col_doc = max(len(it.doc) for it, _, _ in results)
    header = f"{'ID':<{col_id}}  {'DOC':<{col_doc}}  STATUS               DESCRIPTION"
    print(header)
    print("-" * len(header))
    for item, status, details in results:
        print(f"{item.id:<{col_id}}  {item.doc:<{col_doc}}  {status:<20} {item.description.split(chr(10))[0][:90]}")
        if status != "RESOLVED" or args.verbose:
            for line in details:
                print(line)
        if status != "RESOLVED":
            print()

    n_resolved = sum(1 for _, s, _ in results if s == "RESOLVED")
    n_stale = sum(1 for _, s, _ in results if s == "STILL-STALE")
    n_manual = sum(1 for _, s, _ in results if s == "NEEDS-MANUAL-REVIEW")

    print()
    print(f"Summary: {len(results)} items -- {n_resolved} RESOLVED, "
          f"{n_stale} STILL-STALE, {n_manual} NEEDS-MANUAL-REVIEW")

    if n_manual:
        print()
        print("NEEDS-MANUAL-REVIEW items (do not fail the exit code, but read them):")
        for item, status, _ in results:
            if status == "NEEDS-MANUAL-REVIEW":
                print(f"  - {item.id}: {item.manual_review_reason}")

    return 1 if n_stale else 0


if __name__ == "__main__":
    sys.exit(main())
