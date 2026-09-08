# Questions — flag 3

## Q1. Does Halpern & Weissman draw a P-to-NP-complete boundary for a policy
language with deontic structure?

Answer with the theorem and its language. Then the discriminating question: is
their language about *permissions* (access control — may this principal do this
action?) or about *obligations and prohibitions with temporal extent* (which is
$\mathcal{L}_c$)? An access-control tractability result is adjacent, not
overlapping, and saying so precisely is the whole value of this question.

## Q2. Does the deontic-logic complexity literature already locate a frontier
at disjunctive obligation?

Sun & Robaldo, and the defeasible-deontic line. The specific thing to look for:
a result of the form "this deontic fragment is tractable, adding disjunction in
the obligation makes it NP-complete." If that exact result exists, Paper 6's
Theorem 1b is a rediscovery and must be cited as such — which does not destroy
the paper, because Theorem 1b is not where the contribution lives.

## Q3. Does $\mathcal{L}_c$ as a combination appear anywhere?

$\mathcal{L}_c$ = definite Horn rules with $\bot$ heads + ground deontic
obligation/prohibition over scopes and intervals + exclusive interval claims +
difference constraints over deadline variables.

Each ingredient is standard. The question is whether the *combination*, chosen
so that all four conflict types are detectable in one polynomial pass with
witnesses, appears in prior work. Likely answer: no, and that is the honest
contribution. Confirm it rather than assuming it.

## Q4. Is Theorem 1a's complexity bound right, and is it the best known?

$O(H + T\log T + C\log C + V\cdot E)$. Dowling–Gallier gives $O(H)$;
sweep-line gives the log factors; Bellman–Ford gives $V\cdot E$. Check that no
better bound is standard for negative-cycle detection in this setting — there
are faster algorithms for some special cases, and a referee who knows the STN
literature will ask.

## Q5. Does Paper 6 owe a citation to the simple-temporal-network literature?

It uses difference constraints and negative-cycle detection without citing
Dechter–Meiri–Pearl or the STN line that owns them. Yes/no with the specific
reference if yes.

## Q6. Is the normative-conflict-detection problem already named and studied
under a different name?

Search the AAMAS/COIN and business-process-compliance communities with
vocabulary that does not presuppose ours. If Paper 6's Part I is a known problem
with a known name, the paper should use that name — see the renaming register.

## Q7. Should Theorem 1a/1b be called a dichotomy?

Almost certainly yes. Confirm the standard phrasing from Schaefer and draft the
one sentence that frames Theorem 1 as a dichotomy result. This is a
presentational fix that costs nothing and makes the result legible to
complexity theorists.

## Q8. Part II — are $g_A(\rho,c)$ and $D^\star$ novel?

Time-boxed. Confirm the specialist-versus-pool decision boundary with an
accountability term, and the succession-viability threshold, are not standard
results in queueing or operations management. If nothing turns up in a
reasonable search, say so and stop — this is not the flagged risk.

## Q9. Drafted citation text

Sentences for `paper6.tex`'s `\section{Related work}`, in its existing
Imported / Positioned-against / New structure, with `\bibitem` entries. The
paper's current structure makes this easy: most additions belong under
"Positioned against deontic logic," which currently cites only von Wright and
Chisholm and conspicuously omits the computational side of the same field.
