# Questions — flag 2

## Q1. Does arXiv:2607.22868 exist?

Yes or no, with the URLs actually fetched and what each returned. This gates
everything else. Answer before doing any comparison work.

If no: state plainly that the identifier does not resolve and that the earlier
sweep produced a fabricated citation. Note the implication — every `uncertain`
entry from that sweep now needs independent verification before use.

## Q2. If it exists, does it state the same characterization?

Quote its main theorem. Then answer four sub-questions specifically:

- **Same alphabet split?** Does it partition agent events into runtime-mediated
  and model-internal, or does it use a different decomposition?
- **Same criterion?** Is its enforceability condition Ramadge–Wonham
  controllability, or something else (safety alone, a syntactic policy-language
  restriction, a type system)?
- **Same degenerate case?** Does it identify Schneider's theorem as the
  complete-mediation special case, which is Paper 2's specific framing move?
- **The compound case?** Paper 2 says its whole clean-room product line rests on
  "no egress after reading a secret" being regimentable — the policy permits the
  uncontrollable trigger and gates only the controllable effect. Does the
  preprint reach this? It is the least obvious part of Paper 2 and the best test
  of whether the two arrived at the same place.

## Q3. What does Paper 2 have that the preprint does not?

If priority is lost, this is what the contribution paragraph becomes. Candidates
visible in `paper2.tex`: the executable product-automaton checker
(`b3_controllability.py`), the nine-row policy classification table, the
worked synthesis case study producing an actual two-state supervisor, and the
$\sup\mathcal{C}(K) = \emptyset$ result for thought-bans. A theory preprint
plausibly has none of these.

## Q4. Where does "detect-and-compensate" sit in the edit-automata taxonomy?

Ligatti–Bauer–Walker distinguish truncation, suppression, insertion, and edit
automata. Paper 2 uses a binary prevent/detect split. Answer: is Paper 2's
"detect-and-compensate" a mechanism in their taxonomy, or a category outside it
because the compensation is economic (bond slashing) rather than
trace-transforming? The answer determines whether the citation is "we refine
this" or "we sit adjacent to this."

## Q5. Is Paper 2's boundary a special case of the safety-progress hierarchy?

Falcone–Fernandez–Mounier classify enforceable properties within the
safety-progress hierarchy. Paper 2 restricts to prefix-closed safety and then
refines by controllability. Answer whether these are orthogonal refinements of
Schneider (likely) or whether one contains the other. Be specific; this is the
sentence a referee will want.

## Q6. Is the paper's "August-2026 survey found nothing" claim defensible?

The paper asserts it. Verify it independently against the 2024–2026 agent
guardrail literature, searching with vocabulary that does not presuppose the
paper's own terms. If something close exists, name it. If nothing does, say the
sweep was run and came back empty, with the search terms recorded so the claim
is reproducible.

## Q7. Does Paper 2's characterization of Schneider hold up?

Paper 2 says Schneider's execution-monitor theorem is its own theorem's
$\Sigma_u = \emptyset$ case. Confirm from Schneider's actual text that EM
enforcement assumes complete mediation of the event stream. If Schneider's model
is subtler than that, the contribution framing needs adjusting.

## Q8. Drafted citation text

For whatever survives: the sentences to add to `paper2.tex`'s Related Work, in
its existing voice, with `\bibitem` entries. Separately, if the preprint exists
and overlaps, a rewritten contribution paragraph that concedes priority honestly
without overstating the loss.
