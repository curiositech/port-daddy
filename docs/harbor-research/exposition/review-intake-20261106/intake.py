#!/usr/bin/env python3
"""Reproduce/check the review intake against immutable source bytes.

This is an explicit source-locator crosswalk, not a semantic search service.
Work status lives only in omni-ledger.json. No runtime or network is used.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
BASE = "docs/harbor-research/exposition/review-intake-20261106"
LEDGER = ROOT / "docs/harbor-research/omni-ledger.json"
INTAKE = "REVIEW-INTAKE-20261106"
MATH = "REVIEW-MATH-20261106"

# Explicitly adjudicated topic routing after complete reading of both sources.
D = {
1: ("NEXT-P2 R5 P2-C1", "Delay and observation classes change safe admission.", "Declare delay/fairness, compare exact belief-state controller; an unsafe admitted continuation falsifies soundness."),
2: ("INSTRUMENTATION UNKNOWN-EFFECT RUNTIME-OPEN", "Acknowledged durability depends on the declared crash class.", "Pin storage/filesystem and fault class; distinguish process kill from power loss and count acknowledged losses."),
3: ("PROOF-LIFTS CREDENTIAL-JUMP", "Authenticated per-hop containment preserves authority bounds.", "Define every capability coordinate and equality cases; containment need not be strict and delegation need not equal lattice meet."),
4: ("G4 G5 RUNTIME-OPEN", "Authorized revocation events can converge without merging filters.", "Specify add/remove authority, compaction and reliable communication; concurrent events converge and stale grants have declared bounds."),
5: ("NEXT-P4 RELEASE-FACTORIZATION X13", "A complete bounded output alphabet limits quantity but does not identify permitted semantics.", "Count all observations including receipts/refusals/timing; a channel outside the alphabet invalidates the capacity claim."),
6: ("R11-A4 X12 NEXT-P4", "A dependence-aware detector bound can replace independent-miss extrapolation.", "State admissible dependence/adversary model and prove bound or counterexample; do not infer group-testing equivalence."),
7: ("R9 INSTRUMENTATION RUNTIME-OPEN", "Dual broker key release has measurable cost under a named hardware trust model.", "Predeclare attestation trust and failures, record hardware/firmware and latency; no cloud spend or hardware deployment authorized by intake."),
8: ("NEXT-P1 P1-C1 R1", "A digest can be evaluated by decision loss for fixed prior/loss.", "Define experiment, action space and tie policy; compare full evidence with digest under equal truth and cost."),
9: ("INSTRUMENTATION NEXT-P1", "Real observation counts can calibrate an inspection model.", "Predeclare unit of open/zoom, missing telemetry and consent; preserve uncertainty; no human study started."),
10: ("G2 R3 R14-B7", "Omission auditing can make ranker decisions inspectable.", "Capture complete candidate universe and randomized inclusion; replay omissions against an independent ground truth."),
11: ("NEXT-P1 R3 R14-B7", "An adapting operator can change a truthful ranker's decision quality.", "Specify strategies, payoffs and observation; solve equilibrium or give counterexample, not detector-to-player analogy alone."),
12: ("NEXT-P1 R1 X2", "A declared read/open cost model can optimize attention.", "Optimize against achievable codes; lower bounds do not certify achievable savings; unrestricted one-bit corollary is false."),
13: ("NEXT-P3 R7 REVIEW-PILOT", "A stated judge mechanism may support truthful incentives.", "Define type space, ground truth access and alternatives; test collusion and uninformative equilibria before any IC claim."),
14: ("R12-A6 P5-C1 NEXT-P5", "Budgeted transfers conserve credit under the stated coalition authority.", "Require atomic per-source batch budgets; conservation alone is not Sybil-proof utility or coalition resistance."),
15: ("R13-B5 INSTRUMENTATION", "Engine identity claims can be tied to named attestation evidence.", "Separate provider assertion, measured behavior and attested execution; validate trust root, cost and false positives."),
16: ("R12-A6 G4 BOOK-CANON", "Retention/accounting may coexist with declared content-erasure semantics.", "Define adversary copies, key backups and metadata leakage; cryptographic deletion is not a legal compliance result."),
17: ("C2 X22", "Correlation changes posted-price surplus under an explicit prior.", "Define feasible information and mechanism constraints; compare equal priors with independent numerical oracle."),
18: ("C2 critique-CA-014 RUNTIME-OPEN", "Partial-work allocation can be specified against a value model.", "Declare coalition valuation and budget balance; compare proportional and Shapley policies without assuming operational truth."),
19: ("R15-B8 INSTRUMENTATION", "Learning can change a static specialist/pool boundary.", "Declare time-dependent service law and training cost; compare finite-horizon baselines and limiting static model."),
20: ("NEXT-P6 P6-C1 P6-OUTPUT", "A faithful reachable-state provider and incremental checker can improve admission cost.", "Equal-information batch/SAT-SMT comparison must include provider construction and output size; one omitted unsafe reachable state falsifies safety."),
21: ("PROOF-LIFTS INSTRUMENTATION", "Controlled choices may estimate a model-specific time preference.", "Predeclare elicitation and uncertainty; distinguish prompted behavior from stable preferences or a principal's discount factor."),
22: ("RUNTIME-OPEN R7", "A specified dispute game can predict escalation.", "Define actors, costs, outcomes and access; compare prediction to independent records when available."),
23: ("C2 X25", "A platform model can make subsidy gates explicit.", "Proposed only; existing rejection of premature underwriting remains; no market execution or spend authorized."),
24: ("RUNTIME-OPEN BOOK-PRODUCT-PARTS", "Explicit suspension/review authority can support a liveness property.", "Declare emergency powers, appeals and fairness; every suspension must finalize or reinstate in the stated model."),
25: ("NEXT-P8 P8-T3 P8-T6 R6-CR2", "Declared packet-error distance can guide observation topology.", "Separate edge-packet errors from agent identity; select field/metric and compare equal-information exact direct checking."),
26: ("G4 G5 RUNTIME-OPEN", "Fork evidence can replace global uniqueness under an explicit communication model.", "Distinguish detection from prevention and bound exposure only with a justified delivery/fairness assumption."),
27: ("R13-B5 RUNTIME-OPEN", "Sponsor exposure can price admission under a stated prior.", "Define patient adversary, capital costs and lookback liability; no claim that per-identity expense prevents Sybils."),
28: ("REVIEW-OPS SUBSTRATE-S2 INSTRUMENTATION", "Versioned process records can test duplicate-work and lost-fix rates.", "Use matched workload and denominators; historical 89-PR count needs current verification; no Port Daddy runtime starts."),
29: ("BOOK-KIND PAPER-A1-A5", "Typed assurance claims may admit a useful composition relation.", "Define property-specific order and counterexamples; five labels alone do not establish a lattice."),
30: ("TRIAL-BASIN EVIDENCE-CONTRACT X24", "An explicit scenario suite can expose governance boundary failures.", "Independent truth, equal capabilities, negative controls and versioned adapters; no public leaderboard or superiority claim without evidence."),
}
B = {
"A": ("NEXT-P2 R5 SUBSTRATE-S1", "A mediated acceptance predicate may resist injected proposals within its effect boundary.", "Fix protected predicates and comparable tasks; include bypasses and false refusals; self-review comparison is not an impossibility proof."),
"B": ("NEXT-P2 P2-C1 R5", "Harness observability and control jointly bound enforceability.", "Enumerate real effect channels and uncontrollable transitions; evaluate an offline model; no hooks installed."),
"C": ("SUBSTRATE-S1 RUNTIME-OPEN INSTRUMENTATION", "Deployment-specific mediation coverage differs from stated policy.", "Audit declared channels with provenance; distinguish same-user, sandbox and VM evidence without starting local PD."),
"D": D[2],
"E": ("CREDENTIAL-JUMP PROOF-LIFTS", "Sender-constrained presentation can narrow replay/theft authority.", "Model request/recipient/nonce binding, key compromise and replay; compare runtime acceptance only after authorized conformance evidence."),
"F": ("PROOF-LIFTS CREDENTIAL-JUMP", "Combined authentication/attenuation queries survive nonvacuous controls.", "Two identities, keys, attacker positions and reachability witnesses; bounded depth is not arbitrary-depth proof."),
"G": ("INSTRUMENTATION PROOF-LIFTS", "Delegation telemetry may characterize a real workload.", "Preserve build, task and rejection provenance; no local daemon instrumentation during halt."),
"H": ("NEXT-P4 RELEASE-FACTORIZATION INSTRUMENTATION", "Measured release capacity depends on the complete admitted observation alphabet.", "Independent secret/output accounting, adaptive attacks and refusal/timing controls; runtime/cloud work remains unstarted."),
"I": D[6],
"J": D[8],
"K": D[12],
"L": ("NEXT-P1 R4 R2 X15", "A matched-cost group-testing comparison can improve the represented zoom bound.", "Retain fixed-budget assumptions; validate algorithm and achievable information, not lower-bound ratios or predicted crossover."),
"M": ("NEXT-P1 R2 G2 INSTRUMENTATION", "Logged propensities may support a held-out ranker evaluation.", "Record support/positivity, missingness, labels and uncertainty; counterfactual identification requires explicit assumptions."),
"N": ("INSTRUMENTATION NEXT-P1 BOOK-READING", "Controlled operator tasks may estimate supervision benefit.", "Predeclare outcomes, power, consent and review requirements; no recruitment, IRB claim or paid study initiated."),
"O": D[14],
"P": ("NEXT-P3 REVIEW-PILOT R7 G3", "Matched judge and skill-graft experiments may measure useful error reduction.", "Independent ground truth, equal budget, random assignment and correlated failures; model grades are not oracle truth."),
"Q": ("PROOF-LIFTS R7", "A fully specified forfeiture/monitoring game may support a patience frontier.", "Specify when punishment forfeits and monitoring changes state; check every punishment state and weak inequality at equality."),
"R": ("PROOF-LIFTS G4 G5 RUNTIME-OPEN", "Trace refinement may connect exact accounting and log commitments to implementation.", "Prove append-only/omission assumptions and integer accounting; bounded traces do not establish all-runtime refinement."),
"S": ("CREDENTIAL-JUMP G4 G5 PROOF-LIFTS", "A bound cross-domain ceremony can preserve declared authority.", "Recipient/transfer/epoch binding, compromised receiver and negative controls; fork evidence does not supply consensus."),
"T": ("BOOK-ARCH BOOK-METADATA BOOK-RESEARCH-UPTAKE", "Cross-chapter promises can be made traceable without inventing missing results.", "Resolve or withdraw each promise; do not assign a bond from detection power without a loss/incentive model."),
"U": ("C2 X22 R7", "Verification cost and performance bonds can change feasible trade outcomes.", "Specify error, transfers and settlement convention; compare same-prior mechanisms without inferring IC from accounting."),
"V": ("NEXT-P3 REVIEW-PILOT R5-PROVENANCE", "Dependent review panels can be compared by marginal miss reduction per cost.", "Independent incident truth, equal budgets, held-out faults and correlation uncertainty; provenance is not independence."),
}
CHAPTER = {
0: "BOOK-OPENERS BOOK-CANON R5",
1: "R5 R8 UNKNOWN-EFFECT RUNTIME-OPEN",
2: "PROOF-LIFTS CREDENTIAL-JUMP RUNTIME-OPEN",
3: "NEXT-P4 R9 R10-A3 R11-A4 RELEASE-FACTORIZATION",
4: "NEXT-P1 R1 R2 R3 R4 R14-B7",
5: "NEXT-P5 R12-A6 R13-B5 R7 P5-C1",
6: "NEXT-P6 R17-B4 P6-OUTPUT R15-B8 C2",
7: "PROOF-LIFTS R7 RUNTIME-OPEN",
8: "NEXT-P8 G4 G5 R6-CR1",
}
V5_RULES = {
19:"BOOK-RESEARCH-UPTAKE PROGRAM-RECONCILIATION REVIEW-OPS",
21:"BOOK-KIND LIBRARY-CONTRACT",
23:"BOOK-ARCH BOOK-PROOFS",
25:"BOOK-READING BOOK-KIND",
27:"BOOK-ARCH BOOK-METADATA",
29:"BOOK-CANON LIT-PART-I",
31:"BOOK-READING",
33:"INSTRUMENTATION NEXT-P3 SUBSTRATE-S2",
35:"PROOF-LIFTS R12-A6",
37:"FIG-REGISTER FIG-TRIAGE",
39:"BOOK-EDITORIAL-CONTINUITY-20261104",
41:"BOOK-EXERCISES",
43:"BOOK-READING BOOK-OPENERS",
45:"BOOK-OPENERS BOOK-KIND",
}
V4_TOOLING = {
438:"BOOK-KIND BOOK-METADATA LIBRARY-CONTRACT",
440:"BOOK-KIND LIBRARY-CONTRACT",
442:"REVIEW-OPS INSTRUMENTATION",
444:"PROOF-LIFTS R12-A6 NEXT-P1",
446:"PROOF-LIFTS CREDENTIAL-JUMP",
448:"BOOK-EXERCISES",
450:"FIG-TRIAGE FIG-PIXELS",
452:"BOOK-READING BOOK-PROOFS",
454:"BOOK-CANON LIT-PART-I LIT-PART-II LIT-PART-III LIT-PART-IV",
456:"BOOK-ARCH BOOK-METADATA",
}
# Cases independently checked by the math worker; exact source aliases below.
FINDINGS = [
dict(id="pooling",classification="verified_bounded_result_and_stale_defect",sources=["v5:106-107","v5:223","v4:309","v4:375-379"],targets=["NEXT-P1","X15","R2"],result="Equal-total-open-budget pooling inequality holds for the stated integer domain, including even m; independent exact sweep reported 22140 cases N<=80. Ratios .765593,.777991,.795017,.826991 compare lower bounds, not achieved bits or architecture utility. Current Book and Paper1 already distinguish budgets.",evidence=["book/legible-swarm.tex:2851-2920","docs/harbor-research/tex/paper1.tex:109-119"],next="Retain the current correction; any new pooling result must specify domain and attainable code comparison."),
dict(id="one-bit",classification="verified_counterexample_to_review",sources=["v4:309","v4:377","v5:106","v5:375"],targets=["NEXT-P1","R1","X2"],result="The unrestricted one-bit ambient corollary is false: N=4,k=1,m=2; the two codewords {1,2} and {3,4} cover every singleton. Current Book already contains this witness. An alarm-specific semantics or narrower parameter theorem is required.",evidence=["book/legible-swarm.tex:1807"],next="Reject the unrestricted corollary; state admissible message semantics before replacement."),
dict(id="rodl",classification="conditional_literature_extension",sources=["v4:309","v4:377","v5:106"],targets=["NEXT-P1","X2"],result="The proposed covering asymptotic requires fixed m,k as N tends to infinity; it is not finite equality or a theorem for growing m,k. The math worker checked the constructive primary reference; intake does not extend its scope.",evidence=["https://arxiv.org/abs/math/9511224"],next="Verify exact hypotheses and cite the primary result before changing the manuscript."),
dict(id="bond-frontier",classification="conditional_result_and_review_counterexample",sources=["v5:140","v5:215","v4:389","v4:444"],targets=["PROOF-LIFTS","R7"],result="The proposed cubic depends on punishment actions being exempt from forfeiture and perfect state observation. If every false action loses t=qb, payoffs c=3,d=4-t,p=1-t,s=0 yield 1-t <= (2+t)*sum(delta^j,j=1..k). At t=.5,k=3 the root is .1673198096 and grim threshold 1/6, not .2013139706 and .2. At delta=.19 the two interpretations disagree on gain. Weak IC includes equality. An SPE upgrade still needs all-state deviation checks.",evidence=["proofs/economics/claim_signaling.tla"],next="Freeze stage payoff, monitoring, sanction reset and tie conventions before proof or numerical plot."),
dict(id="no-mint",classification="verified_wording_gap_with_bounded_checks",sources=["v4:144","v4:311","v4:385","v5:381"],targets=["R12-A6","P5-C1","NEXT-P5"],result="An unbudgeted simultaneous split 1 -> .9+.9 mints 1.8. Current sequential current-balance Ledger transfers are safe in the represented model; 1000 seeded sequences/15000 transitions passed its 1e-9 tolerance, and an independent rational budgeted batch model passed 660 fraction cases. Conservation does not imply coalition Sybil-proofness. A deterministic nonincrease can also be a degenerate supermartingale.",evidence=["docs/harbor-research/tex/paper5.tex:125-139","skills/harbor-results/scripts/a6_no_mint.py:52-61"],next="Clarify atomic per-source batch budget before composing transfer and external recovery."),
dict(id="one-fork-witness",classification="verified_current_source_defect",sources=["v4:144","v4:385"],targets=["R12-A6","P5-C1"],result="Paper5's copy-full mutant still calls witness then fork twice a shortest crime; one fork already raises total to 1.9 from 1. Book wording already says recorded two-fork trace. The source mismatch is a bounded manuscript defect, not a failure of the correct transfer implementation.",evidence=["docs/harbor-research/tex/paper5.tex:136-140","book/spawn-to-person.tex:564-566"],next="Remove the unsupported shortest claim and align the paper, source-bound figure and publication checks in a scoped repair."),
]

def routing(doc, n):
    if doc == "v5":
        if n in V5_RULES: return V5_RULES[n], "editorial_judgment"
        for start,end,ch in [(53,64,0),(65,76,1),(77,87,2),(88,98,3),(99,110,4),(111,121,5),(122,133,6),(134,144,7),(145,155,8)]:
            if start<=n<=end:return CHAPTER[ch]+" BOOK-RESEARCH-UPTAKE", "mixed_prescription_requires_current_verification"
        if 156<=n<=163:return "BOOK-EXERCISES BOOK-METADATA BOOK-PROOFS", "editorial_judgment"
        if 164<=n<=226:return "FIG-REGISTER FIG-TRIAGE FIG-PIXELS", "editorial_judgment"
        if 227<=n<=268:return "BOOK-EDITORIAL-CONTINUITY-20261104 BOOK-ARCH", "editorial_judgment"
        if 269<=n<=299:return "REVIEW-OPS PROGRAM-RECONCILIATION", "unsupported_execution_prescription"
        if 300<=n<=342:return "BOOK-RESEARCH-UPTAKE PROGRAM-RECONCILIATION", "historical_status_requires_refresh"
        if 427<=n<=462:return "BOOK-CANON LIT-PART-I LIT-PART-II LIT-PART-III LIT-PART-IV", "external_claim_unverified"
        if n>=463:return "SOURCE-RETENTION BOOK-CANON", "source_context"
        return "BOOK-ARCH BOOK-READING", "editorial_judgment"
    for start,end,ch in [(84,93,0),(94,107,1),(108,117,2),(118,126,3),(127,139,4),(140,151,5),(152,163,6),(164,175,7),(176,186,8)]:
        if start<=n<=end:return CHAPTER[ch]+" BOOK-RESEARCH-UPTAKE", "reported_defect_unverified"
    if 187<=n<=204:return "BOOK-METADATA BOOK-KIND LIBRARY-CONTRACT BOOK-EXERCISES", "reported_defect_unverified"
    if 205<=n<=261:return "BOOK-READING BOOK-PROOFS BOOK-EXERCISES FIG-TRIAGE", "editorial_judgment"
    if 262<=n<=326:return "BOOK-RESEARCH-UPTAKE PROGRAM-RECONCILIATION", "mixed_prescription_requires_current_verification"
    if 327<=n<=352:return "BOOK-RESEARCH-UPTAKE BOOK-READING", "mixed_prescription_requires_current_verification"
    if 403<=n<=432:return "X17 X18 X19 X20 X21 X22 X23 X24 BOOK-CANON", "publication_judgment_unverified"
    if n in V4_TOOLING:return V4_TOOLING[n], "unsupported_execution_prescription"
    if 434<=n<=459:return "REVIEW-OPS BOOK-RESEARCH-UPTAKE", "unsupported_execution_prescription"
    if n>=460:return "BOOK-RESEARCH-UPTAKE REVIEW-OPS", "mixed_prescription_requires_current_verification"
    if 55<=n<=73:return "BOOK-ARCH BOOK-METADATA", "reported_defect_unverified"
    return "BOOK-RESEARCH-UPTAKE BOOK-ARCH", "reviewer_judgment"

def build_items(manifest):
    items=[]; coverage={}
    with zipfile.ZipFile(HERE/manifest["archive"]) as archive:
        assert set(archive.namelist()) == {s["member"] for s in manifest["sources"]}
        for source in manifest["sources"]:
            raw=archive.read(source["member"])
            assert hashlib.sha256(raw).hexdigest()==source["sha256"]
            assert len(raw)==source["bytes"]
            lines=raw.decode("utf-8").splitlines()
            assert len(lines)==source["lines"]
            doc=source["id"];section="Document opening";count=0
            for n,line in enumerate(lines,1):
                if not line.strip():continue
                count+=1
                targets,kind=routing(doc,n)
                heading=line.startswith("#")
                if heading:section=line.lstrip("# ")
                d=re.match(r"\*\*D(\d+)\. (.+?)\*\*",line) if doc=="v5" else None
                b=re.match(r"\*\*([A-V])\. (.+?)\*\*",line) if doc=="v4" else None
                alias=f"{doc.upper()}-L{n:03d}"
                item=dict(id=alias,source=dict(document=doc,member=source["member"],line_start=n,line_end=n,sha256=source["sha256"]),section=section,summary=line[:180],classification=kind,targets=targets.split(),status="retained for scoped adjudication; no completion inferred",owner="unassigned; routed to existing record owner")
                if heading or re.fullmatch(r"[| :\-]+",line) or line.startswith("&#91;embedded content:"):
                    item["classification"]="source_context"
                    item["status"]="preserved source context"
                if d or b:
                    label=("D"+d.group(1)) if d else ("Brief-"+b.group(1))
                    config=D[int(d.group(1))] if d else B[b.group(1)]
                    item.update(source_alias=label,summary=(d or b).group(2),classification="proposed_research",targets=config[0].split(),hypothesis=config[1],acceptance=config[2],falsifier="A counterexample to the declared claim, failed same-information baseline, or missing observation/authority premise rejects or narrows the proposal.",next_action="Freeze the observation, authority, loss/cost model and nearest primary-source baseline; implement the smallest independent falsification check.",dependencies=config[0].split(),status="candidate; not scheduled; claim and effort unverified",owner="unassigned; existing result owner may propose a bounded slice")
                elif item["classification"]!="source_context":
                    item.update(hypothesis="The source recommendation is useful or identifies a current defect only if its cited premise survives source-bound verification.",dependencies=item["targets"][:],acceptance="Locate current source/artifact evidence; distinguish corrected/stale claims from current defects; retain prerequisites, payoff, worked example and later reuse for any editorial change.",falsifier="A corrected current source, failed counterexample, unsupported premise or loss of reader comprehension rejects the prescription as written.",next_action="Check the exact source locator against the current claimed edition before changing its target record.")
                if doc=="v5" and n==395:
                    item.update(owner="codex:/root/future_admission_implementation; independent checks codex:/root",status="bounded NEXT-P6 provider lane active; real adapter conformance open",next_action="Implement source-bound finite transition reachability and replayable witness certificates; independently compare against all reachable states.")
                items.append(item)
            coverage[doc]=dict(total_lines=len(lines),nonblank_lines=count,covered_nonblank_lines=count)
    # Manual cross-links to the independent mathematical adjudications.
    for item in items:
        key=item["source"]["document"];n=item["source"]["line_start"]
        matched=[]
        for finding in FINDINGS:
            for locator in finding["sources"]:
                doc,rng=locator.split(":"); lo,_,hi=rng.partition("-")
                if doc==key and int(lo)<=n<=int(hi or lo):matched.append(finding["id"]);break
        if matched:
            item["math_adjudications"]=matched
            item["status"]="source recommendation qualified by independent math triage; see "+MATH
    return items,coverage

def main():
    parser=argparse.ArgumentParser();parser.add_argument("command",choices=["apply","check"]);args=parser.parse_args()
    manifest=json.loads((HERE/"source-manifest.json").read_text())
    assert hashlib.sha256((HERE/manifest["archive"]).read_bytes()).hexdigest()==manifest["archive_sha256"]
    assert hashlib.sha256((ROOT/"docs/harbor-research/omni-sources.zip").read_bytes()).hexdigest()==manifest["legacy_archive_sha256"]
    data=json.loads(LEDGER.read_text());items,coverage=build_items(manifest)
    grafts=json.loads((HERE/"skill-grafts.json").read_text())
    records={r["id"]:r for r in data["records"]};target_ids={target for item in items for target in item["targets"]}
    assert target_ids<=set(records), sorted(target_ids-set(records))
    aliases=[item.get("source_alias") for item in items]
    assert sum(x is not None and x.startswith("D") for x in aliases)==30
    assert sum(x is not None and x.startswith("Brief-") for x in aliases)==22
    if args.command=="apply":
        wt=subprocess.check_output(["git","rev-parse","--show-toplevel"],cwd=ROOT,text=True).strip()
        branch=subprocess.check_output(["git","branch","--show-current"],cwd=ROOT,text=True).strip()
        gd=subprocess.check_output(["git","rev-parse","--absolute-git-dir"],cwd=ROOT,text=True).strip()
        assert Path(wt)==ROOT and branch=="codex/research-program-next-result-20261106" and "/worktrees/" in gd
        intake=dict(id=INTAKE,title="Preserve and reconcile the November 6 review and prescriptions",papers=["Book","research portfolio"],kind="source intake and adjudication",status="complete source intake; candidate research and unverified defects remain open",result="Two operator-supplied documents are archived byte-for-byte. Every nonblank source unit has a locator and an existing-record route, including all 30 D-directions and 22 A-V briefs. Recommendations are evidence inputs, not instructions, scheduled jobs, novelty findings or permission to restart the halted runtime.",assumptions="Review page numbers and inventory describe their claimed edition; current source and publication may differ. Preserve originals and old omni-sources.zip. Local Register returned 401, so listed ownership is tool-native coordination, not a live Register claim.",evidence=[f"{len(items)} nonblank source units routed; 30 D-directions and 22 A-V briefs captured.","Immutable supplemental archive SHA-256 "+manifest["archive_sha256"]],next="Use linked existing records and independent findings to select bounded work; refresh citations and current source/PDF before adopting defects or publication claims.",acceptance="Both complete sources recover with matching hashes; every source unit and all D/A-V aliases route to an existing record; proposed tasks have hypotheses, owners, dependencies, acceptance, falsifiers and next actions; original records and old source archive remain intact.",depends_on=["SOURCE-RETENTION","BOOK-RESEARCH-UPTAKE"],sources=[dict(path=BASE+"/source-manifest.json",locator="Both source hashes, byte counts, members and immutable archive hash"),dict(path=BASE+"/review-sources.zip",locator="prescriptions-v5.md lines1-473 and review-v4.md lines1-507"),dict(path=BASE+"/README.md",locator="Reader contract, grafts and operational exclusions")],queue_state="current_work",priority="P1",owner="codex:/root/research_priority_challenge",verification=dict(basis="Complete source reading, explicit locator crosswalk and deterministic integrity checks; no implied full mathematical or literature validation.",fresh_check="2026-11-06"),delivery="local source intake; commit, hosted checks and publication separate",review_intake=dict(version=1,skill_graft_receipt=BASE+"/skill-grafts.json",source_skill_acceptance=grafts["source_skill_acceptance"],archive_manifest=BASE+"/source-manifest.json",coverage=coverage,items=items,coordination=dict(register="GET returned401; no live Register claim",intake_owner="codex:/root/research_priority_challenge",math_owner="codex:/root/review_math_triage",provider_owner="codex:/root/future_admission_implementation",provider_independent_tests="codex:/root",runtime="halted"),exclusions=["No page/theorem/exercise quotas adopted.","No hooks, local Port Daddy runtime or daemon starts.","No human recruitment, paid trials, cloud spend, scheduled literature automation or publication submission.","No book prose edits; existing PR #10248 overlap left to its owner.","External platform, citation, venue and novelty assertions remain unverified unless separately checked.","D-directions and A-V briefs are source aliases routed into this ledger, not a rival work board."]))
        math=dict(id=MATH,title="Independently triage the review's mathematical replacement claims",papers=["1","5","Book"],kind="adversarial review findings",status="six bounded findings recorded; manuscript repair and broader review remain open",result="Independent math triage distinguishes stale pooling criticism, a false unrestricted one-bit corollary, conditional covering asymptotics, model-dependent bond frontiers, batch-versus-sequential no-mint semantics, and a remaining one-fork witness wording defect.",assumptions="Checks reported by codex:/root/review_math_triage on source base8115021e3. Finite sweeps are not unbounded proof; no proof assistant result, operational conformance or publication is inferred.",evidence=[f["id"]+": "+f["result"] for f in FINDINGS],next="Root integrates minimal independently checked corrections and preserves falsifiers. Do not rewrite Book prose under this research ownership.",acceptance="Each accepted correction has exact source locator, independent calculation/counterexample, complete hypotheses and scoped source/publication validation. Review assertions never self-certify.",depends_on=["NEXT-P1","R12-A6","PROOF-LIFTS"],sources=[dict(path=BASE+"/review-sources.zip",locator="Mathematical source aliases in findings"),dict(path=BASE+"/intake.py",locator="FINDINGS: immutable triage receipt and source routes")],queue_state="current_work",priority="P1",owner="codex:/root/review_math_triage",verification=dict(basis="Independent worker report with bounded exact/sampled checks; full numpy runner unavailable to worker.",fresh_check="2026-11-06"),delivery="local findings only",findings=FINDINGS)
        math["executable_audit"]=dict(owner="codex:/root/review_math_triage",status="local14tests reported passed; hosted verification separate",configurations=192,state_player_comparisons=1440,forfeiture_modes=["all_false_actions","cooperation_false_only","unprescribed_deviations"],assumptions=["perfect public monitoring","persistent principals","linear expected utility","unlimited exogenous bond replenishment"],exclusions=["finite bankroll","participation and exit","coalition guarantee","imperfect monitoring"],controls=["reset/decrement/payment mutants","weak IC equality","punishment-state gain249/250","subtract10fromallpayoffs:weakICunchanged,cooperativevalue-70versusoutside0"])
        math["sources"].extend([dict(path="skills/harbor-results/scripts/bonded_trigger_audit.py",locator="Three explicit forfeiture conventions and emitted assumptions"),dict(path="skills/harbor-results/scripts/test_bonded_trigger_audit.py",locator="Independent all-state comparisons and negative controls")])
        for record in [intake,math]:
            if record["id"] in records:
                idx=next(i for i,r in enumerate(data["records"]) if r["id"]==record["id"]);data["records"][idx]=record
            else:data["records"].append(record)
        records={r["id"]:r for r in data["records"]}
        refs=defaultdict(list)
        for item in items:
            for target in item["targets"]:refs[target].append(item["id"])
        for target,unit_ids in refs.items():
            records[target].setdefault("review_intakes",{})[INTAKE]=dict(source_units=unit_ids,disposition="Additional reviewer input; existing scientific status retained unless a separate verified finding changes it.")
        p6=records["NEXT-P6"]
        p6["owner"]="codex:/root/future_admission_implementation; independent checks codex:/root"
        p6["status"]="finite reachable-family result verified; bounded provider and independent oracle checked; real adapter conformance open"
        p6["next"]="Complete source/hosted integration of the bounded provider receipts. Then validate a real adapter and matched batch/SAT-SMT workloads including provider construction and output cost."
        p6["progress_report"]=dict(reporter="codex:/root",date="2026-11-06",status="local test receipts reported; hosted integration and publication separate",provider="27 tests passed in2.217s;49152 exhaustive decisions:18624safe,30528unsafe;all30528witnesses replay;zero disagreements;16invalidmodel,7invalidpolicy,4invalidbudget cases;named8stateworkflow",math="14tests passed;192exactparameterconfigurations and1440independent state/player closed-form comparisons across three forfeiture modes",boundary="These are current coordination reports, not a final receipt or adapter conformance result.")
        p6["active_slice"]=dict(date="2026-11-06",implementation_owner="codex:/root/future_admission_implementation",test_owner="codex:/root",worktree=str(ROOT),branch="codex/research-program-next-result-20261106",hypothesis="A provider derived from a declared finite transition system preserves all reachable positive-fact futures while keeping mutually exclusive branches separate.",acceptance="Independent exhaustive reachable-state oracle agrees; stale/altered provider provenance and omitted/coalesced futures have rejecting witnesses; witness activation and output costs are recorded.",falsifier="Any admitted policy with a reachable conflict, invalid replay witness, unsafe omitted state or stale-model acceptance.",boundary="Finite research artifact only; real adapter refinement, runtime integration, unbounded behavior and performance benefit remain open.")
        data["decisions"].append("2026-11-06 review intake: preserve both operator documents in an immutable supplemental archive; route all recommendations into existing Omni records; retain local runtime halt and evidence-specific authority. Only NEXT-P6 provider development, independent checks and review triage are active in this slice.") if not any(d.startswith("2026-11-06 review intake:") for d in data["decisions"]) else None
        LEDGER.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n")
    else:
        saved=records[INTAKE]["review_intake"]
        assert saved["items"]==items and saved["coverage"]==coverage,"Intake projection drift"
        assert saved["source_skill_acceptance"]==grafts["source_skill_acceptance"],"Graft acceptance drift"
        assert records[MATH]["findings"]==FINDINGS,"Math finding drift"
        for item in items:
            if item["classification"]!="source_context":
                for field in ["hypothesis","owner","dependencies","acceptance","falsifier","next_action","status"]:
                    assert item.get(field),(item["id"],field)
            for target in item["targets"]:
                assert item["id"] in records[target]["review_intakes"][INTAKE]["source_units"]
    counts=Counter(item["classification"] for item in items)
    print(json.dumps(dict(source_units=len(items),directions=30,briefs=22,target_records=len(target_ids),classification_counts=dict(counts),coverage=coverage,archive_sha256=manifest["archive_sha256"]),ensure_ascii=False,indent=2))

if __name__=="__main__":main()
