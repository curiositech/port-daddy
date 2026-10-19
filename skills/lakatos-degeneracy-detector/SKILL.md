---
name: lakatos-degeneracy-detector
version: 0.1.0
description: >
  Detects degenerating research programmes in AI skill libraries by tracking whether
  version changes narrow a skill's declared scope to exclude anomalies (monster-barring)
  rather than accommodating them through improved theory. Operationalizes Lakatos's
  MSRP distinction between progressive problemshifts (novel predictive content) and
  degenerating ones (content-decreasing post-hoc exclusions), using four instrumented
  signals — Scope Contraction Rate, Novel-case Coverage Ratio, Failure-Exclusion
  Correlation, and Predictive Novelty Score — to emit selection-pressure alerts before
  a skill's hard core is silently hollowed out by accumulated monster-barring moves.
author: soma-windags-graft
tags: [skill-health, lakatosian-msrp, monster-barring, degeneracy-detection, skill-lifecycle, regression, eval, epistemics]
pairs-with: []
---

# Lakatos Degeneracy Detector

## When to Use

- A skill's `SKILL.md` gains new `exclude:`, `not_supported:`, or `preconditions:` clauses in a version bump, especially when no new capability is added in the same version.
- A skill's `NOT_FOR` section grows across revisions while its `When to Use` section stays flat or shrinks — the declared scope is contracting rather than expanding.
- Post-incident review of a skill that failed evaluation and was subsequently "fixed" by narrowing its contract rather than improving its implementation.

NOT for:
- Detecting performance regressions that leave scope unchanged (use AgentAssay or a standard regression harness for that).
- Evaluating whether a skill's initial scope definition is too narrow at creation time (this detector only tracks *changes* across versions).
- Cases where scope contraction is documented as a known temporary regression with an external cause and a tracked recovery plan — that is a "stagnant programme," not a degenerating one (see Adamou 2024).

## Core Concepts

**Hard Core vs. Protective Belt** (Lakatos 1978): A skill's hard core is its declared invariant capability — the contract stated in `SKILL.md` that defines what the skill *is*. The protective belt is everything adjustable without abandoning that contract: prompt templates, model pins, chunk sizes, retry logic, output formatting. Legitimate version improvements modify the belt. Monster-barring corrupts the hard core by retracting it.

**Monster-Barring** (Lakatos 1976): The strategy of handling a counterexample not by improving the proof or theory but by redefining the domain to exclude the offending case. In skill terms: after an input class causes failures in evaluation, adding a `precondition:` or `exclude:` clause that retroactively removes that class from the skill's declared scope. The theorem is "preserved" while its coverage quietly shrinks. Distinguishable from legitimate scope refinement by one test: does the change generate novel predictions (new capabilities), or does it only remove known anomalies?

**Progressive vs. Degenerating Problemshift** (Lakatos 1978): A sequence of modifications is *progressive* if each version is both theoretically progressive (predicts novel facts not predicted by the prior version) and empirically progressive (at least some novel predictions are corroborated by passing evals). A sequence is *degenerating* if modifications are content-decreasing — they re-describe known failures after the fact with no novel predictive power. The programme shrinks to avoid falsification rather than growing to explain more.

**Failure-Exclusion Correlation (FEC)**: The fraction of new scope restrictions added in version N for which a failing evaluation case matching that restriction existed in version N-1's eval logs. FEC > 0.7 means ≥70% of the new exclusions retroactively cover known failures — the monster-barring threshold. Computed by diffing `SKILL.md` scope clauses across versions and joining against the eval failure log.

**Predictive Novelty Score (PNS)**: Whether scope changes in `SKILL.md` were committed *before* matching eval failures appeared (legitimate anticipatory scoping) or *after* (post-hoc exclusion). Track `SKILL.md` commit timestamps against eval-failure timestamps. Legitimate refinements precede failures; monster-barring follows them. This is the causal direction test.

## Implementation Pattern

```
# Inputs:
#   skill_versions: list of (version_tag, SKILL_md_text, eval_run_log) tuples, oldest first
#   failure_log: list of (timestamp, version_tag, input_case, failure_reason)
#   commit_log: list of (timestamp, version_tag, changed_file, diff)

function detect_degeneracy(skill_versions, failure_log, commit_log):

    alerts = []

    for i in range(1, len(skill_versions)):
        prev_ver, prev_md, prev_evals = skill_versions[i-1]
        curr_ver, curr_md, curr_evals = skill_versions[i]

        # --- Signal 1: Scope Contraction Rate (SCR) ---
        prev_exclusions = extract_exclusion_clauses(prev_md)  # NOT_FOR + exclude: + preconditions:
        curr_exclusions = extract_exclusion_clauses(curr_md)
        new_exclusions = curr_exclusions - prev_exclusions
        SCR = len(new_exclusions)

        # --- Signal 2: Novel-case Coverage Ratio (NCR) ---
        new_passing = cases_passing_in_curr_not_in_prev(curr_evals, prev_evals)
        new_total_changes = len(new_exclusions) + len(new_passing)
        NCR = len(new_passing) / new_total_changes if new_total_changes > 0 else 0.0
        # Progressive: NCR > 0.5 (more expansions than contractions)
        # Degenerating: NCR < 0.2 (nearly all changes are exclusions)

        # --- Signal 3: Failure-Exclusion Correlation (FEC) ---
        prior_failures = [f for f in failure_log if f.version_tag == prev_ver]
        matched = 0
        for exclusion in new_exclusions:
            if any(exclusion_matches_failure(exclusion, f) for f in prior_failures):
                matched += 1
        FEC = matched / len(new_exclusions) if new_exclusions else 0.0
        # Monster-barring threshold: FEC > 0.7

        # --- Signal 4: Predictive Novelty Score (PNS) ---
        exclusion_commits = [c for c in commit_log
                             if c.version_tag == curr_ver
                             and 'SKILL.md' in c.changed_file
                             and any(e in c.diff for e in new_exclusions)]
        anticipatory = 0
        for commit in exclusion_commits:
            matching_failures = [f for f in failure_log
                                  if exclusion_matches_failure_by_text(commit.diff, f)
                                  and f.timestamp > commit.timestamp]
            if matching_failures:
                anticipatory += 1
        PNS = anticipatory / len(exclusion_commits) if exclusion_commits else 1.0
        # PNS == 1.0: all exclusions precede failures (legitimate)
        # PNS == 0.0: all exclusions follow failures (pure monster-barring)

        # --- Alert thresholds ---
        if SCR >= 1 and FEC > 0.7 and NCR < 0.2:
            alerts.append({
                "level": "DEGENERATING_PROGRAMME",
                "version": curr_ver,
                "SCR": SCR, "FEC": FEC, "NCR": NCR, "PNS": PNS,
                "new_exclusions": list(new_exclusions),
                "action": "require_positive_heuristic_roadmap"
            })
        elif SCR >= 1 and PNS < 0.3:
            alerts.append({
                "level": "MONSTER_BARRING_SUSPICION",
                "version": curr_ver,
                "SCR": SCR, "FEC": FEC, "NCR": NCR, "PNS": PNS,
                "new_exclusions": list(new_exclusions),
                "action": "flag_for_review_within_48h"
            })

    return alerts

# Gate: a skill version with SCR >= 1 and no corresponding expansion (NCR < 0.2)
# cannot merge without one of:
#   (a) a positive-heuristic roadmap: at least one new eval case in EXPANDED territory
#   (b) an exception documenting external cause (stagnant programme, not degenerating)
#       with a linked recovery issue
```

**Rehabilitation path**: A degenerating alert does not kill a skill. The required output is a positive-heuristic roadmap — a documented commitment to add eval cases in *expanded* territory (input classes outside both the old and new scope). This is tracked as a required follow-up issue and blocks the next version merge until at least one such case passes.

**Stagnant programme exemption**: If the scope contraction is caused by an external constraint (e.g., underlying model deprecated, API removed, compliance restriction), document the external cause explicitly and link a recovery issue. This maps to Adamou's (2024) "stagnant programme" third category — acceptable if external, not acceptable as a permanent state.

## Key References

1. **Lakatos, I. (1978).** *The Methodology of Scientific Research Programmes: Philosophical Papers, Volume 1.* Cambridge University Press. Primary source for hard core, protective belt, progressive/degenerating problemshift, negative/positive heuristic. SEP entry: https://plato.stanford.edu/entries/lakatos/

2. **Lakatos, I. (1976).** *Proofs and Refutations: The Logic of Mathematical Discovery.* Cambridge University Press. Primary source for monster-barring, exception-barring, lemma incorporation, and the Euler polyhedra case study that grounds the canonical definition.

3. **Dunleavy, P. (2022).** "Progressive and degenerative journals: on the growth and appraisal of knowledge in scholarly publishing." *Research Integrity and Peer Review.* PMC9643948. The most operationalized existing MSRP application: Mistake Index = articles / corrections; Scite Index = supporting / (supporting + contrasting). Working 2x2 classification matrix. https://pmc.ncbi.nlm.nih.gov/articles/PMC9643948/

4. **Adamou, A. (2024).** "Stagnant Lakatosian Research Programmes." arXiv:2404.18307. Formalizes the third category between progressive and degenerating — programmes blocked by external constraints rather than internal methodological failure. Provides four demarcation criteria. Critical for the stagnant-programme exemption gate. https://arxiv.org/html/2404.18307v2

5. **Barr, B. et al. (2026).** "AgentAssay: Token-Efficient Regression Testing for Non-Deterministic AI Agent Workflows." arXiv:2603.02601. Provides the statistical machinery (Wilson score intervals, Clopper-Pearson) for capability regression detection in agent systems — the closest existing implementation to what a skill health monitor needs for the eval-comparison step. https://arxiv.org/pdf/2603.02601

6. **Anonymous (2026).** "Benchmark Health Index: A Systematic Framework for Benchmarking the Benchmarks of LLMs." arXiv:2602.11674. Three-metric framework (Capability Discrimination, Anti-Saturation, Impact) applied to 106 benchmarks. Directly applicable to eval-suite health monitoring for the NCR signal. https://arxiv.org/abs/2602.11674
