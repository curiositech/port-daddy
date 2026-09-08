# Flag 2 — priority risk on the enforceability characterization

**Paper**: 2, *Regimented or Enforced: The Controllability Boundary for Agent
Governance* (`docs/harbor-research/tex/paper2.tex`)

**Risk**: priority, not correctness. Nothing here suggests the theorem is wrong.
The question is whether someone published it first, and whether the paper's
contribution paragraph survives contact with the answer.

## The claim under test

The paper's contribution, stated in its own Related Work
(`paper2.tex:281–286`):

> Recent agent-guardrail work (2024–2026) invokes this security canon for LLM
> runtimes but, to our knowledge from an August-2026 survey, does not state the
> controllability characterization; the mapping of agent-runtime enforcement
> onto supervisory control, and the resulting exact prevented/detected boundary,
> is the contribution […] A final lit-sweep before submission is owed: "not
> found" is not "proven nonexistent."

The paper is admirably honest that this is a not-found claim. This dive is the
owed sweep.

The theorem itself imports Ramadge–Wonham controllability unchanged and claims
no new control theory. What is claimed as new is the *mapping*: that an LLM
agent runtime's event alphabet splits into mediated effects ($\Sigma_c$) and
model-internal steps ($\Sigma_u$), and that a governance policy is preventable
iff it is controllable with respect to that split — with Schneider's
execution-monitor theorem as the $\Sigma_u = \emptyset$ degenerate case.

## The competing work

A scout reported **arXiv:2607.22868, "What Can Be Enforced? A Theory of
Certified Runtime Safety for Tool-Using Agents"** — same year, same domain,
apparently the same characterization.

**Treat this as unverified to the point of possibly not existing.** It was
reported once and never retrieved. An arXiv identifier beginning `2607` would be
July 2026, which is plausible on its face, and that plausibility is exactly what
makes it dangerous: a fabricated identifier of the right shape is the most
common failure mode of literature search by language model. The first job of
this dive is to establish whether the paper exists at all.

Three outcomes, all useful:

1. **It exists and covers the same ground** — priority is lost or shared. The
   paper's contribution paragraph must be rewritten honestly. This is
   survivable: independent concurrent derivation is normal, citable, and
   respectable, and Paper 2 has a mechanized checker and a policy table that a
   pure-theory preprint likely does not.
2. **It exists and is different** — cite it, position against it, move on.
3. **It does not exist** — the finding is that the earlier sweep produced a
   fabricated citation, which matters beyond this paper: it means the other
   scouts' `uncertain` entries need the same treatment. Record it prominently.

## The second, quieter risk

Independent of the preprint, Paper 2 does not cite the runtime-enforcement
literature that grew out of Schneider — Ligatti–Bauer–Walker's edit automata,
and Falcone–Fernandez–Mounier's *"What can you verify and enforce at runtime?"*,
whose title is nearly Paper 2's own question. That line refines Schneider's
truncation-only monitors into suppression, insertion, and edit automata, which
is close to Paper 2's "detect-and-compensate" category.

This is a real gap regardless of what happens with the preprint, and it is more
likely to be raised by a referee than the preprint is. A dive that resolves only
the preprint question and ignores this has done half the job.

## What a resolution looks like

`findings.md` opens with the verdict, then:

- A definitive statement on whether arXiv:2607.22868 resolves, with the URL
  actually fetched and what came back.
- If it exists: its main theorem quoted, and a side-by-side against Paper 2's
  box — same alphabet split? same controllability criterion? does it handle the
  compound trigger→effect case that Paper 2 says the clean-room product rests
  on?
- A separate section on the edit-automata / Falcone line: what it proves, where
  "detect-and-compensate" sits in its taxonomy, and whether Paper 2's boundary
  is a special case of the safety-progress hierarchy.
- Drafted citation sentences for whatever survives, in the paper's existing
  imported/adjacent/new voice.
