# Reading list — flag 2

## Tier 0 — establish existence before anything else

**arXiv:2607.22868, "What Can Be Enforced? A Theory of Certified Runtime Safety
for Tool-Using Agents"** — status `uncertain`, existence unestablished.

Check, in order, and record what each returns:

1. `https://arxiv.org/abs/2607.22868`
2. arXiv listing search for the exact title string
3. arXiv full-text search for the title
4. Semantic Scholar, DBLP, Google Scholar for the title
5. A title-keyword search without the identifier, in case the ID is wrong but
   the paper is real under a different number

If all five come back empty, the finding is that the identifier was fabricated.
Say so directly in `findings.md` — do not soften it, and do not go looking for
"something similar enough" to justify the original report. A fabricated citation
found and named is a good outcome.

If the paper does exist, read it in full before comparing.

## Tier 1 — the gap that exists regardless

1. **Ligatti, J., Bauer, L., Walker, D. "Edit Automata: Enforcement Mechanisms
   for Run-time Security Policies."** *International Journal of Information
   Security* 4(1–2):2–16, 2005.
   The refinement of Schneider: truncation, suppression, insertion, edit. Read
   for where Paper 2's "detect-and-compensate" sits, and whether the
   controllability split has an analogue in their mechanism taxonomy.

2. **Falcone, Y., Fernandez, J.-C., Mounier, L. "What can you verify and enforce
   at runtime?"** *STTT* 14(3):349–382, 2012.
   Title is nearly Paper 2's question. Maps the safety-progress hierarchy to
   enforceability. The single most likely source of a referee's "isn't this
   already known?" — read carefully and answer it in advance.

3. **Schneider, F. B. "Enforceable Security Policies."** *ACM TISSEC*
   3(1):30–50, 2000.
   Already cited in `paper2.tex`. Re-read only to confirm Paper 2's
   characterization of it as the $\Sigma_u = \emptyset$ case is exactly right —
   this is load-bearing for the contribution claim and should not rest on a
   remembered reading.

## Tier 2 — the control-theory side

4. **Ramadge, P. J. and Wonham, W. M.** 1987 and 1989. Already cited. Read only
   to confirm the controllability statement is quoted correctly and that
   Paper 2's use of the supremal controllable sublanguage is standard.

5. **Lin, F. and Wonham, W. M. "On observability of discrete-event systems."**
   *Information Sciences* 44(3):173–198, 1988. Already cited, in Paper 2's
   future-work section. Read enough to confirm the partial-observation framing
   there is accurate.

6. **Rudie, K. and Wonham, W. M. "Think Globally, Act Locally: Decentralized
   Supervisory Control."** *IEEE TAC* 37(11):1692–1708, 1992.
   Not cited. Relevant if more than one daemon mediates disjoint parts of the
   alphabet, which is the realistic deployment. Note whether it belongs.

## Tier 3 — the agent-guardrail literature the paper gestures at

7. Survey the 2024–2026 LLM agent sandboxing / guardrail / tool-use safety
   literature for anything stating an enforceability characterization. The paper
   claims a survey found none; verify that claim rather than inheriting it.
   Search terms that do not presuppose our vocabulary: "what policies can an
   agent sandbox enforce", "runtime enforcement LLM agent", "tool-use mediation
   guarantees", "preventable vs detectable agent policy".

8. If anything in Tier 3 looks close, apply the same primary-source rule: read
   it, quote the theorem, compare hypotheses.

## Retrieval notes

- Ligatti et al. and Falcone et al. both have freely available author PDFs.
- Do not cite anything found only in a citation list of another paper. Fetch it.
- Record the URL actually fetched for every source, so the sweep is repeatable.
