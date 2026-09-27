# FormalJudge: bounded external context

[FormalJudge: A Neuro-Symbolic Paradigm for Agentic Oversight](https://arxiv.org/abs/2602.11136), Zhou et al. (2026), describes a neuro-symbolic oversight approach using Dafny specifications and Z3 solving. Its reported results belong to that paper's evaluated settings, including the abstract's 16.6% average improvement across seven agent models and its deception-detection experiment.

It does **not** establish a Lean 4 pipeline, 91%/74% syntactic-validity figures, microsecond checking, local integration, complete mediation, or production effectiveness here.

## Local hypothesis

A local adjudicator might use a separately reviewed Dafny/Z3-derived policy artifact as one input to a pre-effect decision. That is a hypothesis: pin the paper version, policy artifact, verifier version, model, workload, and target-side witness; test the exact integration before making a performance or enforcement claim.

Accessed 2026-09-23.
