# Cross-Document Verification Pass (falsification-first)

Method: for each item, both documents were read in full at the cited locations, quoted
verbatim, and an active attempt was made to find a reading under which the flagged claim
would be **wrong**. A1's algebra was redone from scratch (symbolically by hand, then
checked numerically over a 2000-point random grid and at every instance paper6 quotes).
No document was edited.

Repo state: branch `claude/white-paper-pr-review-uncpxg`, working tree clean at
`127ffc91f`. Note on file locations: `spawn-to-person.tex` and
`federated-harbor-whitepaper.tex` live under `whitepaper/source/` (with a
byte-identical mirror in `website-v2/dist/whitepaper/`), **not** under `whitepaper/`,
which holds only `legible-swarm.tex` and `single-writer-kernel.tex`.

---

## A1

**Verdict: CONFIRMED** — and stronger than the review stated. The two formulas are
algebraically identical, the whitepaper's version is provably wrong in both directions,
and the corpus's own execution report already records that this fold is owed and undone.

### Evidence — Document 1: `/home/user/port-daddy/whitepaper/source/legible-swarm.tex` L867–877

```latex
\begin{theorem}[Queueing Specialization Boundary]\label{thm:specialization}
Let requests for an invariant-critical function $F$ arrive as a Poisson stream at rate $\lambda_F$. A sole specialist operates as an $M/M/1$ queue with service rate $\mu_{\mathrm{spec}}$, while a pooled generalist swarm operates as an $M/M/c$ queue with total service rate $c \mu_{\mathrm{pool}}$.

Sole ownership strictly dominates pooled generalist service in mean response time if and only if the specialist efficiency ratio exceeds the queueing congestion threshold:
\begin{equation}
\frac{\mu_{\mathrm{spec}}}{\mu_{\mathrm{pool}}} \;>\; 1 + \frac{(c-1)\lambda_F}{c\mu_{\mathrm{pool}} - \lambda_F}.
\end{equation}
Below this threshold, sole ownership buys strict single-writer accountability at an explicit latency price that must be budgeted rather than obscured.
\end{theorem}

\noindent\emph{Status: proposed.} The threshold form follows the standard $M/M/1$ vs.\ $M/M/c$ response-time comparison; the full derivation (including the succession corner where the sole specialist fails, an $M/M/1$ queue with breakdowns) is carried as item B8 of the research ledger.
```

### Evidence — Document 2: `/home/user/port-daddy/whitepaper/research/tex/paper6.tex` L233–239, L243–254

L233–239 (§ "Part II. The sole owner: an inequality, not a principle"):

> The whitepaper's sole-responsibility roles (roadmap owner, test-suite curator, release avatar) trade pooled capacity for accountability and skill. Model the trade honestly. Requests for the invariant-critical function arrive Poisson at rate $\lambda$; a sole specialist serves them as an $M/M/1$ queue at rate $\mu_s$; the pooled alternative is an $M/M/c$ queue of generalists at rate $\mu_g$ each, utilization $\rho=\lambda/(c\mu_g)$; the skill premium is $r=\mu_s/\mu_g$. […] **The whitepaper proposed the threshold $\tilde g = 1+(c-1)\rho/(1-\rho)$ and marked it *status: proposed*. The sweep ran before the belief formed — and falsified $\tilde g$ in both directions.**

L243–254 (boxed Theorem 2):

> **Theorem 2 (queueing specialization boundary).** With $C(c,\rho)$ the Erlang-C delay probability, sole ownership weakly dominates the pool in net cost iff the skill premium clears
> $$\frac{\mu_s}{\mu_g} \;\ge\; g_A(\rho,c) \;=\; c\rho \;+\; \frac{1}{\,1 + \frac{C(c,\rho)}{c(1-\rho)} + \frac{A\mu_g}{w\lambda}\,},$$
> reducing at $A=0$ to $g(\rho,c) = c\rho + \frac{c(1-\rho)}{c(1-\rho)+C(c,\rho)}$, with $g(\rho,1)=1$ […], $g\to c$ as $\rho\to 1$ (the boundary *saturates* at the capacity ratio, never diverges), and the closed form $g(\rho,2)=1+2\rho-\rho^2$ [verified: derivation below]. The proposed threshold $\tilde g = 1+(c-1)\rho/(1-\rho)$ is **falsified in both directions**: at $c{=}2,\rho{=}0.1,r{=}1.15$ it certifies a specialist who loses ($W_{\mathrm{solo}}=1.0526 > W_{\mathrm{pool}}=1.0101$; simulation $z=-15.7$), at $c{=}2,\rho{=}0.5,r{=}1.9$ it rejects a specialist who wins ($1.111 < 1.333$; $z=+32$); the two thresholds cross at $\rho=(3-\sqrt5)/2\approx0.382$, and where $g$ saturates $\tilde g$ diverges ($\rho{=}0.9, c{=}8$: $g=7.73$ vs $\tilde g=64$) [internal, `b8_specialization.py`, seed 20260816].

### My own algebra (every step, no rounding)

Definitions are compatible: legible-swarm says the pool is "an $M/M/c$ queue with **total**
service rate $c\mu_{\mathrm{pool}}$", so per-server rate is $\mu_{\mathrm{pool}}$ and
paper6's $\rho=\lambda/(c\mu_g)$ is exactly the same utilization with
$\lambda\!\mapsto\!\lambda_F$, $\mu_g\!\mapsto\!\mu_{\mathrm{pool}}$,
$\mu_s\!\mapsto\!\mu_{\mathrm{spec}}$. Substituting $\lambda_F = c\rho\,\mu_{\mathrm{pool}}$:

```
        (c-1) λ_F                 (c-1) · c ρ μ_pool
1 + ─────────────────── = 1 + ─────────────────────────────
     c μ_pool − λ_F              c μ_pool − c ρ μ_pool

                              (c-1) · c ρ μ_pool
                        = 1 + ──────────────────────        [factor c μ_pool out of denom.]
                              c μ_pool · (1 − ρ)

                              (c-1) ρ
                        = 1 + ─────────                      [cancel c μ_pool, μ_pool > 0]
                               1 − ρ

                        = g̃(ρ, c).                          ∎
```

The cancellation is exact for all $c\ge 1$, $\mu_{\mathrm{pool}}>0$, $0<\rho<1$ — no
approximation, no dropped term. Numerical confirmation over 2000 random
$(c,\mu_{\mathrm{pool}},\rho)$ triples: max
$|\text{whitepaper RHS} - \tilde g| = 7.6\times10^{-12}$ (float noise only). **The
review's substitution is correct: these are the same formula.**

I then rederived paper6's replacement independently rather than trusting it. Sole
ownership wins on mean response time iff $W_{\mathrm{solo}} < W_{\mathrm{pool}}$, i.e.
$1/(\mu_s-\lambda) < W_{\mathrm{pool}}$, i.e. $\mu_s > \lambda + 1/W_{\mathrm{pool}}$.
Dividing by $\mu_g$ and using $\lambda/\mu_g = c\rho$ and the textbook M/M/c identity
$\mu_g W_{\mathrm{pool}} = 1 + C(c,\rho)/(c(1-\rho))$:

$$ r \;>\; c\rho + \frac{1}{1 + \frac{C(c,\rho)}{c(1-\rho)}} \;=\; c\rho + \frac{c(1-\rho)}{c(1-\rho)+C(c,\rho)} \;=\; g(\rho,c). $$

This is paper6's $g_A$ at $A=0$, which is the right comparator since legible-swarm's
theorem is about **mean response time only** (no accountability term). Checks:

| $c$ | $\rho$ | $C(c,\rho)$ | $g(\rho,c)$ (correct) | $\tilde g$ (whitepaper) |
|---|---|---|---|---|
| 2 | 0.1 | 0.018182 | **1.1900** | 1.1111 |
| 2 | 0.3 | 0.138462 | **1.5100** | 1.4286 |
| 2 | 0.5 | 0.333333 | **1.7500** | 2.0000 |
| 8 | 0.9 | 0.701534 | **7.7328** | 64.0000 |

Closed form $g(\rho,2)=1+2\rho-\rho^2$ reproduces exactly at $\rho\in\{0.1,0.3,0.5,0.77\}$.
Crossing: $1+2\rho-\rho^2 = 1+\rho/(1-\rho) \Rightarrow \rho^2-3\rho+1=0 \Rightarrow
\rho=(3-\sqrt5)/2 = 0.3819660112501051$ — paper6's number, confirmed.

Both falsification instances reproduce independently at $\mu_g=1$:

- $c{=}2,\rho{=}0.1,r{=}1.15$: $\lambda=0.2$, $W_{\mathrm{solo}}=1/(1.15-0.2)=1.05263$,
  $W_{\mathrm{pool}}=1+0.018182/1.8=1.01010$. Solo is **worse**. Whitepaper's rule
  ($1.15>1.1111$) says *adopt sole ownership*. **False positive.**
- $c{=}2,\rho{=}0.5,r{=}1.9$: $\lambda=1.0$, $W_{\mathrm{solo}}=1/0.9=1.11111$,
  $W_{\mathrm{pool}}=1+0.33333/1.0=1.33333$. Solo is **better**. Whitepaper's rule
  ($1.9 < 2$) says *do not*. **False negative.**

Structural argument (independent of any instance): as $\rho\to1$, $C(c,\rho)\to1$ and
$c(1-\rho)\to0$, so $g\to c\rho\to c$ — the true boundary saturates at the capacity
ratio, which is the physically correct answer (a specialist can never need more than $c\times$
the pool's per-server rate, since that is the pool's entire capacity). $\tilde g\to\infty$.
The whitepaper's threshold is therefore not merely mis-tuned; it is asymptotically wrong.

### Adversarial attempts that failed to refute

1. *Maybe $\rho$ means something different in each document?* No — legible-swarm defines
   the pool's total service rate as $c\mu_{\mathrm{pool}}$, making $\rho=\lambda_F/(c\mu_{\mathrm{pool}})$
   the standard utilization, identical to paper6's.
2. *Maybe the strict `>` vs. weak `≥` matters?* No — the discrepancy is $O(1)$ in size
   (1.19 vs 1.11; 7.73 vs 64), not a boundary-case artifact.
3. *Maybe the whitepaper is right at some $c$?* Only at $c=1$, where both reduce to
   $r>1$ and the theorem is vacuous. For every $c\ge2$ they differ everywhere except the
   single crossing point.
4. *Maybe paper6 is attacking a different whitepaper's threshold?* paper6 L233 names the
   exact three roles legible-swarm §`sec:sole-roles` lists ("roadmap owner, test-suite
   curator, release avatar") and L238 quotes the exact status tag ("marked it *status:
   proposed*") that appears verbatim at legible-swarm L877. It is unambiguously this theorem.

### Corroborating find (not in the original flag)

`/home/user/port-daddy/whitepaper/research/tex/exec5.tex` L155 already books the fix as
outstanding work:

> Remaining: Papers 5–7 assemblies […] and **the whitepaper folds (`thm:specialization` must adopt the exact $g$**; the context-paging and escalation status notes upgrade to executed).

So the corpus's own execution ledger records that legible-swarm's Theorem is known-falsified
and that the fold was never performed. This is not a discovered inconsistency — it is a
tracked, unpaid debt that shipped.

### What this means for the fix

`thm:specialization` cannot be repaired by editing the status tag. The inequality itself
must be replaced by paper6's `g_A(ρ,c)` (or its `A=0` reduction `g(ρ,c)` if legible-swarm
wants to keep the pure mean-response-time framing), with the `c=2` closed form
$g(\rho,2)=1+2\rho-\rho^2$ as the hand-checkable instance, the saturation property
$g\to c$ stated, and the "Status: proposed" note upgraded to the executed B8 result with
a pointer to `b8_specialization.py`. Two sentences worth keeping from paper6: the
saturation-vs-divergence contrast, and the crossing at $\rho=(3-\sqrt5)/2$ that explains
why the old threshold errs in *both* directions. Highest priority of the six items.

---

## A6

**Verdict: CONFIRMED.** Mutually exclusive claims about the same mechanism, in the same
document, with no reconciling status marker. The contradiction is in fact three-way, not
two-way.

### Evidence

`/home/user/port-daddy/whitepaper/source/single-writer-kernel.tex` L1298 (Table `tab:threat-model`,
row "Different-uid process"), verbatim:

```latex
Different-uid process & \textbf{in (partial)} & Owner-only permissions; but the socket peer-credential check is a software handshake, not the kernel-enforced socket credential (\texttt{SO\_PEERCRED}) --- a real authentication caveat. \\
```

Same document L1393 (§ "Hash-chain tamper-evidence and OS-Level Ephemeral Namespaces (OP-9)"),
verbatim:

```latex
To actually solve the same-machine adversary vulnerability (OP-9) locally, we introduce \textbf{OS-Level Ephemeral Namespaces}. The central \texttt{agentsd} process is isolated to run as user \texttt{0600}. When spawning agents, it executes them within \texttt{bwrap} or \texttt{unshare} sandboxes, assigning each an ephemeral UID. IPC sockets strictly enforce \texttt{SO\_PEERCRED} validation, guaranteeing that the daemon can cryptographically bind incoming requests to a specific, sandboxed spawn instance, making same-user filesystem bypasses impossible.
```

A third site, L822, restates the table's position and cross-references it:

```latex
We note in \S\ref{sec:threatmodel} that
the peer-credential check is a software handshake, not the kernel-enforced
socket-level credential check (\texttt{SO\_PEERCRED}) it resembles --- a real
trust-boundary caveat.
```

And a fourth, L1606 (Open Problems roll-up), takes the L1393 side:

```latex
\item[$\bigstar$ OP-9 --- Same-machine adversary.] Solved via \textbf{OS-Level Ephemeral Namespaces}. \texttt{agentsd} runs as user \texttt{0600}; spawns execute in \texttt{bwrap}/\texttt{unshare} sandboxes with ephemeral UIDs, and IPC sockets strictly enforce \texttt{SO\_PEERCRED}.
```

Complete `SO_PEERCRED` occurrence set in the live tree (worktree copies excluded):
`single-writer-kernel.tex` L822, L1298, L1393, L1606. Nothing else in the repo.

### Adversarial attempts that failed to refute

1. *Two different sockets?* The kernel ships two transports (L815–820), so this was the
   most promising escape. It fails: L820–822 says the *second* transport is the one "with
   peer-credential authentication", and it is precisely that one L822 flags as a software
   handshake. So the caveat attaches to the transport that has the check at all, which is
   the same IPC socket L1393 claims strictly enforces `SO_PEERCRED`. There is no third
   socket.
2. *Two different adversaries?* No. The table row is "Different-uid process"; L1393
   claims the mechanism makes "same-user filesystem bypasses impossible" — but the
   binding it relies on to do that is `SO_PEERCRED` on the IPC socket, the identical
   mechanism the table says is not kernel-enforced. Ephemeral UIDs make the same-user
   adversary into a different-uid adversary, which lands it squarely in the table row
   that says the check is software-only.
3. *One is a proposal, one is current state?* This would rescue it, but the text does not
   support it. L1393 is in the present indicative with no status macro, in a document that
   uses explicit status macros (`\Built`, `\BuiltWeak`, `\Vision`) elsewhere on exactly
   this kind of claim (see L1065–1080). L1606 goes further and marks OP-9 "Solved". The
   table has no forward-pointer to L1393.
4. *Sequencing — table describes the pre-OP-9 state?* Refuted from within the document:
   L1418, **after** L1393, still poses OP-9 as open in an exercise:
   `\textbf{(open, $\bigstar$ OP-9)} What is the minimal hardening that closes the
   same-machine adversary without a hardware trusted-platform-module dependency...`
   The document therefore asserts, in one section, that OP-9 is open, solved, and
   defended-by-a-caveated-software-handshake.

The two claims are also not both satisfiable in fact: `SO_PEERCRED` either is or is not
read via `getsockopt(2)`; a software handshake over the same socket provides no
kernel-attested peer identity. Further, "cryptographically bind" is not what `SO_PEERCRED`
does — it returns a `struct ucred` (pid/uid/gid) recorded by the kernel at `connect(2)`;
there is no cryptography involved. That is an independent error in the L1393 sentence.

### What this means for the fix

One of the two must go, and the table is the decisive one (it is the document's stated
security contract, and L822 depends on it). The L1393/L1606 block should be restated as a
design proposal with a status marker — matching how L1073 and L1100 handle OP-4 — or, if
`SO_PEERCRED` genuinely is now enforced in code, the table row and L822 must be updated
together and the L1418 exercise retired. Either way "cryptographically bind" should become
"bind to the kernel-reported peer uid/pid", since `SO_PEERCRED` is not a cryptographic
primitive. Note this is the same failure shape as A7's OP-4 (see below): a later
"solved/realized" edit was applied to the roll-up sections without reconciling the earlier
sections that state the problem is open.

---

## A7

**Verdict: CONFIRMED.** The near-verbatim passage appears in both chapters, no formal
paper contains any of its vocabulary, and paper5's Honest Boundary contradicts the
strength of the claim. Two additional refuting documents were found that the flag did not
cite.

### Evidence — `spawn-to-person.tex` L757–758 (inside a `\pitfall{}` box)

```latex
\pitfall{Selling a summary-forwarding restart organ as real checkpointing would
violate the system's own \textbf{honest-attestation} discipline: \emph{only report
``all good'' when you have actually verified it --- absence of error is not
attestation}. Strong continuity --- the kind that lets a successor \emph{resume}
rather than \emph{inherit a summary} --- is now solved via \textbf{Event-Sourced Neural Rehydration} (OP-4). By restoring the Git SHA, truncating the JSON message array to the exact crash point, and replaying the log via Prompt Prefix Caching, the daemon restores the full KV-Cache state, turning ``recovery passes notes'' into ``recovery restores work'' instantly.}
```

The construction is self-undermining: a pitfall box warning against overclaiming
checkpointing ends by overclaiming checkpointing. Six lines above it (L745–752) the same
document says the organ "**forwards a summary, not state** […] The successor inherits a
note about what the predecessor was doing, not the live belief state it was doing it
with. […] the current organ has gums."

### Evidence — `spawn-to-person.tex` L1688–1689 (Open Problems, item 2)

```latex
  \item \textbf{Agent-death taxonomy (\S\ref{sec:organs}).} What is recoverable vs.\
  fundamentally lost when an LLM agent dies mid-thought? Solved via \textbf{Event-Sourced Neural Rehydration} (OP-4).
```

A list explicitly introduced as "The genuinely unsolved problems this paper surfaces"
(L1682) whose item 2 announces itself solved.

### Evidence — `single-writer-kernel.tex` L1597

```latex
\item[$\bigstar$ OP-4 --- Checkpoint with teeth.] Realized via \textbf{Event-Sourced Neural Rehydration}. By restoring the Git SHA, truncating the JSON message array, and replaying via Prompt Prefix Caching, the daemon restores the full KV-Cache state, turning ``recovery passes notes'' into ``recovery restores work.''
```

Near-verbatim with the spawn-to-person passage minus the word "instantly".

### Evidence — the §7 body text and figure caption it contradicts

`single-writer-kernel.tex` L1069–1074:

> **Checkpoint** is `\BuiltWeak`, and the weakness is precise. The recovery pipeline runs a heartbeat watchdog $\to$ stale/dead detection $\to$ a recovery queue $\to$ a salvage handoff, and it *passes notes*; it does not checkpoint execution state. **A checkpoint with teeth — the gap between passing notes and restoring work — is open problem OP-4, the most important unbuilt thing at this layer** because it is the literal foundation of any reputation economy.

`whitepaper/source/figures/fig-swk-continuity-organs.tex` L52–57 (caption of `fig:swk-continuity-organs`):

> **Checkpoint** is `\textsf{partial}`: recovery (heartbeat $\to$ stale/dead $\to$ queue $\to$ salvage handoff) passes the durable notes but does not capture execution state, so it is the weakest continuity link — **a checkpoint with teeth (a real execution-state snapshot, OP-4) is the literal foundation of a cross-machine reputation economy.**

And `single-writer-kernel.tex` L1100–1104 still poses OP-4 as an open exercise
("What is the minimal durable artifact that turns ``recovery passes notes'' into
``recovery restores work''?"), as does L1484 and L1631. So within
`single-writer-kernel.tex` alone, OP-4 is simultaneously "the most important unbuilt
thing at this layer" (L1073), an open starred exercise (L1100), and "Realized" (L1597).

### Evidence — `paper5.tex` L250–253 (Honest Boundary)

```latex
\begin{boundary}
\textbf{Honest boundary.} The migration result is bounded small-model checking of the \emph{protocol spec} --- depth 7, at most 2
migrations, integer scores; a deployment must refine the machine, and the check certifies the clauses have teeth, not that the
clause list is complete. Def.~III.6.1 is score-only, so the escrow side of clause (iii) enters as attribution --- the default lands
on an identity --- not as a monetary conservation theorem. Continuity witnesses attest lineage, not welfare: nothing here says the
checkpoint restored the agent's ``experience,'' only that the ledger followed the right body.
\end{boundary}
```

Confirmed verbatim, and on-point: the whitepaper chapters claim restoration of *the live
belief state* ("the full KV-Cache state", "restores work"); paper5 says the formal result
attests only *lineage* — which body the ledger followed — and explicitly disclaims any
claim about restored experience.

### Grep results (exact, `.claude/worktrees/` excluded)

`grep -rni "rehydrat" --include=*.tex .`
```
./whitepaper/source/spawn-to-person.tex:758
./whitepaper/source/spawn-to-person.tex:1689
./website-v2/dist/whitepaper/spawn-to-person.tex:758      (mirror of the above)
./website-v2/dist/whitepaper/spawn-to-person.tex:1689     (mirror of the above)
./whitepaper/source/single-writer-kernel.tex:1597
```

`grep -rniE "KV[- ]cache" --include=*.tex .`
```
./whitepaper/source/spawn-to-person.tex:758
./website-v2/dist/whitepaper/spawn-to-person.tex:758
./whitepaper/source/single-writer-kernel.tex:1597
./whitepaper/research/tex/doc1_treatise.tex:54           ← refutation, see below
./whitepaper/research/tex/review.tex:237                 ← refutation, see below
```

`grep -rn "OP-4" --include=*.tex .`
```
./whitepaper/source/spawn-to-person.tex:758, 1689
./website-v2/dist/whitepaper/spawn-to-person.tex:758, 1689
./whitepaper/source/single-writer-kernel.tex:1073, 1080, 1100, 1484, 1585, 1597, 1631
./whitepaper/source/figures/fig-swk-continuity-organs.tex:56
```

`grep -rniE "rehydrat|KV[-]?cache|OP-4|prefix cach" whitepaper/research/tex/paper[1-7].tex`
```
(no matches)
```

**Confirmed: zero occurrences of "rehydrat", "KV-cache", "OP-4", or "prefix cach" in any
of paper1–paper7.** The mechanism exists only in the two whitepaper chapters and their
website mirrors. Nothing in the formal corpus supports it.

### Two additional refutations the flag did not cite

`whitepaper/research/tex/doc1_treatise.tex` L54 already adjudicated this exact claim and
ruled against it:

> The product review claims event-sourcing the exact JSON context array plus a Git SHA, replayed under prefix caching, restores neural state for "fractions of a cent" — "the JSON ledger IS the neural state." The rigor review gives an impossibility argument: two hidden provider states $h_1\neq h_2$ can export the same transcript and capsule $C$ yet require different next actions, so a provider-neutral restorer seeing only $C$ cannot preserve both trajectories. *Resolution:* **the rigor review is correct and the product review is overclaiming** […] prefix-cache replay of the message array restores behavior **within one provider/model/version** […] it does **not** restore behavior across providers, because KV-cache, sampling state, and hidden activations are not exported. […] **replace "IS the neural state" with "is a sufficient statistic for same-provider continuation and a semantic capsule for cross-provider *succession*."** Define correctness at the work-protocol boundary […] not bit-identity.

`whitepaper/research/tex/review.tex` L237:

> **You cannot checkpoint the provider's KV-cache or weights**; you can checkpoint the *semantic* state […] The right correctness notion is behavioral, not bitwise: replay fidelity. Because sampling is nondeterministic, a restored agent is a Parfitian *survivor*, not an identical continuation […]

So the phrase "the daemon restores the full KV-Cache state" is not merely unsupported by
the formal papers — it is the specific formulation the corpus's own resolution document
instructed be replaced, and it survived into two shipping chapters anyway.

### Adversarial attempts that failed to refute

1. *Is the pitfall box maybe quoting the wrong claim in order to criticize it?* No — the
   box's structure is "warning … *is now solved via* …"; the solving sentence is the box's
   conclusion, not its target.
2. *Does paper5's boundary address a different mechanism?* It addresses "the checkpoint"
   and "continuity witnesses" in the migration/resurrection result — the same continuity
   claim the chapters key on. It is on-point.
3. *Is "instantly" material enough to matter?* Yes: prefix-cache replay is a prefill,
   which costs time and money proportional to context length; and the claim silently
   assumes same-provider/model/version, per doc1_treatise.

### What this means for the fix

Not an exposition problem — a claim-strength problem in three places plus a figure caption.
Both chapters need the sentence downgraded to what doc1_treatise L54 already specifies:
same-provider/model/version *behavioral* continuation from an event-sourced semantic
capsule, not restoration of KV-cache state, and *task* continuity with *actor* replacement
across providers. Delete "instantly". Restore OP-4 to open status in
`single-writer-kernel.tex` L1597 and `spawn-to-person.tex` L1689 so they stop contradicting
L1069–1074, L1100, and the `fig:swk-continuity-organs` caption. If the fold is wanted in
the formal direction, paper5's Honest Boundary is the sentence to cite, and it constrains
rather than supports the claim.

---

## A8

**Verdict: CONFIRMED.** Four distinct confidence registers for one claim, and paper3 does
supply a closed parameterized theorem covering the same recursion with the quoted numbers.

### Evidence — `spawn-to-person.tex` §9, the four registers

**Register 1 — cured (prose, L1483–1485):**

```latex
Option~A initially pushed the problem up a level: who audits the auditors? The naive recursion ``rate the raters who rate the
raters'' introduced a severe \emph{Algorithmic Mode Collapse} vulnerability, where a monoculture of model architectures could form a cartel of mutual validation. We cure this via two mandated mechanisms that force the recursion to terminate.
```

**Register 2 — mathematically certain (key-idea box, L1504–1505):**

```latex
\keyidea{The grading oracle is the required assumption hidden under every IC
claim in the economy. By bounding the dishonesty payoff with a mathematically certain VRF slash, the rate-the-raters recursion collapses: the market enforces its own honesty without relying on infinite re-audits.}
```

**Register 3 — conjecture (the actual statement, L1500–1502):**

```latex
\begin{conjecture}[Re-Audit Contraction]\label{conj:contract}
Let $q_k = \rho_k d_k$ be the composite probability of sampling and detecting a corrupt grade at audit level $k$, $B_k$ be the auditor's slashable bond, and $G_k$ be the corrupt gain. If expected forfeiture satisfies $q_k B_k > G_k$ and remaining corruption opportunity contracts as $G_{k+1} \leq \lambda G_k$ with $\lambda \in [0, 1)$, the recursive audit tower contracts to an honest fixed point.
\end{conjecture}
```

**Register 4 — open problem (twice).** Exercise, L1512:

```latex
$\star$ \textit{Open.} (4) Prove or refute Conjecture~\ref{conj:contract}. If the
re-audit probability $\rho$ is too low, the tower is not contractive --- find the
critical $\rho^\star$ as a function of bond size and bribe ceiling.
```

Open Problems roll-up, L1693–1695:

```latex
  \item \textbf{The grading-oracle / rate-the-raters recursion (\S\ref{sec:oracle},
  Conj.~\ref{conj:contract}).} Prove the re-audit tower contracts, or accept the
  core IC theorem is conditional.
```

**A fifth register**, in the same document's status table at L1655:

```latex
Grading-oracle hole (Prop.~\ref{prop:hole}, Conj.~\ref{conj:contract}) & \VISION &
\emph{Owed back to the market paper}: its central IC theorem is conditional on closing this. \\
```

So within one chapter: cured / mathematically certain / conjectured / open / `\VISION`.

Two further technical problems in the same passage, found while checking:

- The stated local deterrence condition is $P(\text{Honeypot}) > G_k/B_k$ — this omits the
  detection probability. Paper3's stage-game threshold is $\rho d B \ge G$; the chapter's
  inequality is the $d{=}1$ special case, i.e. it assumes a perfect detector.
- "mathematically certain VRF slash" misdescribes what a VRF does. The document's own next
  sentence is correct — "The VRF proves to all participants that the injection rate was
  truly random and untamperable" — i.e. the VRF makes the *rate verifiable*, not the slash
  certain. Slashing remains probabilistic by construction.

### Evidence — `paper3.tex` supplies the closed theorem

Boxed theorem, `/home/user/port-daddy/whitepaper/research/tex/paper3.tex` L111–119:

```latex
\begin{theorem}[Tower contraction]\label{thm:tower}
Let level $k{+}1$ audit level-$k$ auditors, each audit sampled sealed (the draw unknown to the briber) from a pool spanning $C$ disjoint cliques, each auditor bonded at $B$ with audit parameters $(\rho, d)$ and bribe floor $\beta = \rho d B$. Then the briber's expected net value is affine in the number of cliques bought, $c \in \{0,\dots,C\}$: buying $c$ still leaves the un-bought $(C{-}c)/C$ share of the sampling weight exposed to the same per-draw audit-and-detect risk $\rho d$, so the payoff has no interior optimum and rational bribery is all-or-nothing --- partial bribery is (weakly) dominated by one of the two corners. Bribing all $C$ is profitable iff
\[ G_k \,\rho d \;>\; C\beta \quad\Longleftrightarrow\quad G_k \;>\; C\,B. \]
Below that threshold bribery stops and corrupt value decays geometrically:
\[ G_{k+1} \;=\; (1-\rho d)\,G_k. \]
Consequently \emph{finite} bond capital certifies a tower deep enough to drive surviving corrupt value below any fixed unit: $B$ per level for $\lceil \log G_0 / \log\frac{1}{1-\rho d} \rceil$ levels --- a depth logarithmic in the initial corrupt value, not an unbounded one.
\end{theorem}
```

The theorem comes with a proof sketch (L121–123), a per-level-vs-programme dominance
argument (L125), and a "why sealing is essential" section (L127).

Numbers, `paper3.tex` L129 and L131:

> **Numbers by hand.** $G_0 = 400$ […] $\rho = \rho^\star = 0.25$, so $\beta = \rho d B = 10$ and $\rho d = 0.2$. […] At $C{=}8$ […] the collapse is geometric at $(1-\rho d) = 0.8$ per level […] In the geometric regime the levels needed to drive corrupt value below one unit: $\lceil \log 400 / \log 1.25 \rceil = 27$, **so total bond capital $27 \times 50 = 1350$** [verified, arithmetic].

> **What the clique multiplier actually buys.** […] at these parameters $C{=}1$ terminates too. Run its recursion to the end: the linear phase carries $400$ down to $50$ in $35$ levels, at which point $G_k \le CB$ and the geometric phase needs $\lceil \log 50/\log 1.25\rceil = 18$ more, **for $53$ levels and $53 \times 50 = 2650$ of bond capital** [verified, arithmetic; regenerates from `b2_tower.py`]. Against $C{=}8$'s $27$ levels and $1350$, the multiplier is a factor of two in certified depth and capital, **not the difference between convergence and divergence.**

And §`sec:conjecture` (L166–174) closes the loop explicitly, naming the same two
mechanisms spawn-to-person "mandates":

> The source volume's central open question --- Conjecture III.11.1, the grading-oracle problem --- asked whether a recursive rate-the-raters scheme can terminate. […] *Model heterogeneity supplies the cliques.* […] *VRF honeypots implement the sealed audit.* […] *The termination is named, not wished.* The tower roots in an exogenously honest anchor --- the operator at $n{=}1$, a bonded arbitration market at scale --- and Theorem~\ref{thm:tower} prices the depth: $27$ levels and bond capital $1350$ at the running parameters [verified, arithmetic]. […] **The conjecture thereby becomes a *parameterized theorem***.

Confirmed: same recursion (rate-the-raters / who-audits-the-auditors), same two mechanisms
(model heterogeneity, VRF honeypots), and paper3 *derives* $G_{k+1}=(1-\rho d)G_k$ where
spawn-to-person's conjecture merely *hypothesizes* $G_{k+1}\le\lambda G_k$. Paper3 is
strictly stronger: it supplies the $\lambda$, supplies the bribery cutoff $G_k>CB$ that
spawn-to-person's conjecture has no analogue for, and prices the depth.

### Adversarial attempts that failed to refute

1. *Is paper3's tower a different recursion?* No. Both are "level $k{+}1$ audits level $k$",
   both parameterized by $(\rho, d, B, G)$, both credit the same two source reviews. Paper3
   §`sec:conjecture` names the heterogeneity+VRF pair verbatim.
2. *Are the numbers actually in paper3?* Yes, both pairs — 53/2650 at $C{=}1$ and 27/1350
   at $C{=}8$ — at L129, L131, L171. Both tagged `[verified, arithmetic]` and reproducible
   from `b2_tower.py`.
3. *Is spawn-to-person's conjecture maybe broader, so paper3 doesn't close it?* The
   opposite. Spawn-to-person's conjecture is *narrower and weaker*: it assumes the
   contraction it should be proving.

### One caveat the fix must not lose

Paper3 does **not** license "the recursion collapses" unconditionally. Its Honest
Boundaries section (L149 in the earlier draft, §`sec:boundaries` in the current file)
records three riders that the whitepaper's key-idea box ignores: (a) sealed sampling is a
*hypothesis*, not hygiene — a leaked draw collapses the clique multiplier to $C{=}1$ and
puts the VRF sampler inside the TCB; (b) the tower needs an *exogenously honest root*
(the operator at $n{=}1$, a bonded arbitration market at scale) — "the theorem prices the
depth to that root; it does not conjure the root"; and (c) paper3 L131 explicitly warns
that the natural reading "overstates the case", since $C{=}1$ terminates too — heterogeneity
removes the linear phase, it is not what makes the tower converge.

### What this means for the fix

`Conjecture~\ref{conj:contract}` should be promoted to a theorem imported from paper3
(`thm:tower`), with the two hand-checkable number pairs, the $\rho d B \ge G$ stage
condition replacing the $d$-free $P(\text{Honeypot}) > G_k/B_k$, and the three riders above
carried over. The prose "We cure this via two mandated mechanisms that force the recursion
to terminate" then becomes true-as-stated for the first time. "Mathematically certain VRF
slash" should go regardless — it is wrong about VRFs on its own terms. And L1512, L1693,
and the L1655 `\VISION` row must be updated in the same pass, or the chapter will still
carry four registers with a theorem in the box instead of a conjecture.

---

## A9

**Verdict: CONFIRMED**, with an additional, sharper defect found: the spectral-gap
sentence is not merely unsupported — the object it invokes is not defined by the section
that sets up the sheaf.

### Evidence — `federated-harbor-whitepaper.tex` L502 (§5.5, `\paragraph{Sheaf Laplacian Dynamics.}`)

```latex
\paragraph{Sheaf Laplacian Dynamics.} On a cellular network complex, the \textbf{Hansen--Ghrist Sheaf Laplacian}~\cite{hansengrist2019} is defined as $\Delta_{\mathcal{F}} = \delta^* \delta$. Its harmonic space $\ker(\Delta_{\mathcal{F}}) \cong H^0(X; \mathcal{F})$ is precisely the subspace of globally synchronized ledger states. The spectral gap $\lambda_2(\Delta_{\mathcal{F}})$ (the smallest non-zero eigenvalue of the sheaf Laplacian) governs the diffusion rate of anti-entropy gossip, establishing a rigorous bound on the relaxation time required for the federation to reach global consensus.
```

Confirmed: no status macro, no citation attached to the gossip/relaxation-time claim
specifically (the `hansengrist2019` cite two sentences earlier attaches to the *definition*
of $\Delta_{\mathcal{F}}$), no artifact, no numbers.

### Evidence — absent from Appendix A

`/home/user/port-daddy/whitepaper/source/federated-harbor-whitepaper.tex`
L1007–1036, `\section{Verification Status}\label{app:fh-mech}`, table `tab:fh-status`.
Complete claim column, verbatim:

| Claim | Method | Result |
|---|---|---|
| Single-harbor capability authenticity (inherited) | ProVerif 2.05 | Closed |
| Cross-realm authenticity (§fh-xfer) | ProVerif (draft) | Partial, pending witness-log freshness assumption |
| Attenuation monotonicity across boundary (Lem. fh-att) | ProVerif + Anchor sub-result | Partial |
| Federated revocation dissemination (Prop. fh-conv) | Conditional epidemic model | Partial — **expected asymptotic result; no partition deadline** |
| Cross-witness equivocation evidence | Signed-root comparison; dissemination model | Partial — verification immediate once views meet; **no hard delivery bound** |
| Escrow extraction bound (Prop. fh-escrow-bound) | Transition-system case analysis | Partial |
| Cross-harbor Conservation (§fh-tla-ext) | TLA+ / Apalache, \|F\| ≤ 4 | Partial |
| Trustless settlement for non-fungible bonds | — | Open |
| Multi-principal correlated-equilibrium extension | — | Open |
| Cross-federation cartel-resistance bound | — | Open |

**No row mentions the sheaf, the Laplacian, the spectral gap, or a relaxation-time bound.**
Confirmed absent. Worse, the two rows that *do* cover federation-wide convergence say the
opposite of the §5.5 sentence: "no partition deadline" and "no hard delivery bound". So the
whitepaper's own status table says the federation's convergence-time claim is unbounded,
while §5.5 asserts "a rigorous bound on the relaxation time required for the federation to
reach global consensus."

The section's `\emph{Status (statistical harness)}` paragraph (L500) does **not** cover
this claim — it appears *before* the Laplacian paragraph and scopes itself explicitly to
the completion-residual detector ("The working detector is the least-squares *completion
residual* $r$…"), 200 trials per arm, `sheaf_harness_v2.py`. It says nothing about
$\lambda_2$, diffusion, gossip rate, or relaxation time.

### Grep results — `paper7.tex`

`grep -nE "spectral gap|lambda_2|\\lambda_\{?2|Hansen|Ghrist|relaxation|gossip|Laplacian" whitepaper/research/tex/paper7.tex`

- **"spectral gap": 0 hits. "$\lambda_2$": 0 hits. "relaxation": 0 hits.**
- "Hansen"/"Ghrist": 3 hits — L116, L343–344, L421 (bibliography). All background:
  - L116: `the cohomological name buys the connection to Curry~\cite{curry} and Hansen--Ghrist~\cite{hansen-ghrist} and costs nothing else.`
  - L343–344 (§Related work, "Imported"): `the sheaf Laplacian and its harmonic/spectral reading are Hansen--Ghrist \cite{hansen-ghrist}.`
  - L421: bibitem.
- "Laplacian": 8 hits, all in one role — a **linear-solver device** for computing the
  detection residual, never a spectral bound:
  - L128–129: `Finally the \emph{graph Laplacian} $\delta^{\!\top}\delta$ is the matrix whose linear systems compute all of the above, and whose near-linear-time solvers~\cite{spielman-teng} are what make the detector cheap enough to run every gossip round.`
  - L30, L58, L270, L302, L333: complexity statements — "computes in $\widetilde{O}(|E|\cdot L)$ via per-coordinate graph Laplacians", "at most $L$ scalar Laplacian solves", "a handful of Laplacian solves".
- "gossip": many hits, all describing the *setting* (relays gossiping signed log heads) or
  detector cost per round. None asserts a convergence-rate bound.

Read in context, paper7's only rate-like quantity is **effective resistance**
$R_{\mathrm{eff}}(e)$ (L123–127), used for *detectability* of a lie on an edge —
"conviction weakens like $1/\sqrt n$" around a long cycle — which is a detection-strength
statement, not a consensus-relaxation-time statement.

**Confirmed: paper7 never uses the spectral gap to bound gossip relaxation time anywhere.**

### The sharper defect (found adversarially, not in the original flag)

I tried to rescue the claim by granting Hansen–Ghrist the underlying mathematics, since
their spectral theory of cellular sheaves genuinely does relate $\lambda_2(\Delta_{\mathcal F})$
to convergence of sheaf diffusion $\dot x = -\Delta_{\mathcal F}x$ toward
$\ker\Delta_{\mathcal F}\cong H^0$. The rescue fails on two independent grounds:

1. **The sheaf in this section has no Laplacian.** L488 defines
   `\mathcal{F}(U)` as "**the semilattice** of prefix-compatible append-only logs, with
   restriction maps given by prefix projection". A semilattice is not an inner-product
   space; $\delta^*$, $\Delta_{\mathcal F}=\delta^*\delta$, eigenvalues, and $\lambda_2$
   are undefined over it. (Contrast paper7 L136, which is careful to set
   $x_v\in\mathbb{R}^{d_v}$ precisely so the Laplacian exists.) The paragraph silently
   swaps to "a cellular network complex" without saying it is a different object.
2. **Anti-entropy gossip is not linear diffusion.** Hansen–Ghrist's rate governs a
   continuous-time linear heat flow over $\mathbb{R}$-valued stalks. Anti-entropy gossip
   over signed append-only logs with a Byzantine equivocator is discrete, asynchronous,
   adversarial, and monotone-join rather than linear-averaging. The $\lambda_2$ bound does
   not transfer, and no argument is offered that it does.

### What this means for the fix

Three options, in decreasing order of cost. (a) Cut the last sentence of L502 — the two
preceding sentences ($\Delta_{\mathcal F}=\delta^*\delta$, $\ker\Delta_{\mathcal F}\cong H^0$
= globally synchronized states) are correct once the stalks are real vector spaces and are
enough to motivate the section. (b) Keep it as an explicitly-tagged conjecture with a status
macro and a Appendix A `\Open` row, stating the linearization assumption it needs. (c) If
it is meant to be essential, it needs its own result and must be reconciled with the
"no partition deadline" / "no hard delivery bound" rows it currently contradicts. Whichever
is chosen, L488 must first give $\mathcal F$ vector-space stalks, or the Laplacian sentence
has no referent. Do **not** cite paper7 in support — paper7 supplies no such bound.

---

## A10

**Verdict: PARTIALLY-CONFIRMED.** The displayed "iff" does conflate the two statements —
the math is wrong as written, and paper7's warning is exactly on point. But the flag's
framing understates the document: the whitepaper's own scope rider, in the paragraph
immediately after the box, states paper7's warning almost verbatim. The defect is a box
that contradicts its own rider, not an unnoticed error.

### Evidence — `federated-harbor-whitepaper.tex` L488–498

```latex
The global consistency of federated witness logs can be modeled category-theoretically. Let $(X, \le)$ be the poset of administrative domains with morphisms given by scoped visibility. A presheaf $\mathcal{F}$ over $X$ assigns to each domain $U$ the semilattice of prefix-compatible append-only logs $\mathcal{F}(U)$, with restriction maps given by prefix projection.

\begin{theorem}[Equivocation as Cohomological Obstruction]\label{thm:sheaf-equivocation}
Let $\mathcal{U} = \{U_i\}$ be an open cover of the harbor network. A collection of local witness logs $\{s_i \in \mathcal{F}(U_i)\}$ glues into a unique global consensus state $s \in \mathcal{F}(X)$ if and only if the \v{C}ech 1-cohomology obstruction vanishes:
\begin{equation}
[\delta s]_{ij} \;=\; s_i|_{U_i \cap U_j} - s_j|_{U_i \cap U_j} \;=\; 0 \quad\iff\quad H^1(\mathcal{U}; \mathcal{F}) \;=\; 0.
\end{equation}
By the Abramsky--Brandenburger contextuality equivalence~\cite{abramsky2011operational}, an equivocation (a harbor signing two mutually incompatible prefixes) is mathematically isomorphic to Bell contextuality in relational semantics: local observations that cannot be factored through any deterministic global hidden state.
\end{theorem}
```

Immediately following, L498 — the scope rider:

```latex
\noindent\emph{Scope (what the theorem does and does not license).} Three bindings keep this claim inside its proven regime. \textbf{(i) The obstruction lives in the data, not the sheaf:} the detector is the observed disagreement cochain's failure to be a coboundary (its harmonic residual), not $\dim H^1$ of the abstract sheaf, which is a property of the restriction maps alone and is blind to any particular lie. […]
```

### Evidence — `paper7.tex` L213–216

```latex
A second misread: the detection statistic is the \emph{data} residual, never
$\dim H^1$ --- a loopy topology has $\beta_1>0$ for purely topological reasons on honest data too, so any counting claim
must net $\beta_1$ out; the harness prints the structural cokernel separately (e.g.\ the two-path split-view topology:
$\beta_1=1$, $\operatorname{coker}=2$) and scores only the residual, which is identically zero for honest worlds.
```

### Why the displayed "iff" is wrong (independent check)

Three distinct errors, all in one line:

1. **Type error.** The left side is an *element* condition (a specific 1-cochain vanishes);
   the right side is a *group* condition (a cohomology group is trivial). An "iff" between
   them is not well-formed as stated.
2. **Both directions fail even charitably.** $H^1(\mathcal U;\mathcal F)=0$ says *every*
   1-cocycle is a coboundary — a property of the cover and the restriction maps alone,
   independent of the observed $\{s_i\}$. It neither implies nor is implied by
   $\delta s = 0$ for the particular family at hand. Concretely: take a cover with
   $H^1=0$ and a family that disagrees on an overlap — $\delta s \ne 0$ while $H^1=0$
   (⇐ fails). Take an acyclic-data family on a cover with $H^1\ne0$ — $\delta s=0$ while
   $H^1\ne0$ (⇒ fails).
3. **The bracket makes it vacuous.** For any 0-cochain $(s_i)$, $\delta s$ is by
   construction a coboundary, so its class $[\delta s]$ in $H^1$ is *always* zero
   regardless of any equivocation. The interesting quantity is the cochain $\delta s$
   itself, not its class — which is the same distinction the rider makes.

The correct statement is the sheaf gluing axiom: $\{s_i\}$ glues to a *unique* global
section iff $\delta s = 0$ on all overlaps (uniqueness from separatedness / $H^0$), with
$H^1$ playing no role. Paper7's whole apparatus is built the right way around: the
detection statistic is the least-squares *completion residual* $r$ on the observed data,
and paper7 L208 warns "a loopy topology has $\beta_1>0$ for purely topological reasons on
honest data too" — i.e. the structural quantity fires on honest worlds, which is exactly
what makes the whitepaper's "iff" unsafe as a detector spec.

An additional problem, inherited from A9: the subtraction $s_i|_{U_i\cap U_j} - s_j|_{U_i\cap U_j}$
requires additive inverses, but L488 gives $\mathcal F(U)$ only a **semilattice**
structure. The displayed formula is not defined over the sheaf the section constructs.

### Why this is PARTIALLY, not fully, confirmed

The document is not blind to the error. Scope rider (i) states paper7's exact warning, in
the whitepaper's own words, one paragraph later — "the detector is the observed
disagreement cochain's failure to be a coboundary (its harmonic residual), **not
$\dim H^1$ of the abstract sheaf, which is a property of the restriction maps alone and is
blind to any particular lie**." Riders (ii) (cycles are essential; cut edges see
nothing) and (iii) (non-vanishing is an alarm, vanishing is not an all-clear — the Carù
gap) likewise track paper7's honest boundary faithfully. The `Status (statistical harness)`
paragraph at L500 also correctly describes the detector as the completion residual.

So the accurate characterization is: **the boxed theorem and its own scope rider assert
incompatible things**, and the rider is right. A reader who reads only the box — which is
what a boxed theorem is for — takes away the wrong statement; a reader who continues one
paragraph gets it corrected without being told a correction occurred.

Also worth noting for the fix: `thm:sheaf-equivocation` appears nowhere in the Appendix A
verification-status table either (see A9's table transcription). The section's only status
evidence is the inline harness paragraph.

### What this means for the fix

The rider is already the correct content, so this is cheap. Replace the displayed equation
with the gluing statement it actually means —

$$\{s_i\}\ \text{glues to a unique } s\in\mathcal F(X) \iff \delta s = 0 \ \text{on all } U_i\cap U_j,$$

— and, if the cohomological framing is wanted, state separately that the *detection
statistic* is the harmonic residual of the observed $\delta s$ (paper7's $r$), with
$\dim H^1$ / $\beta_1$ netted out as structure. Drop the brackets around $\delta s$. Give
$\mathcal F$ real vector-space stalks at L488 so both the subtraction and (per A9) the
Laplacian are defined. Then rider (i) stops contradicting the box and starts explaining it.
Since A9 and A10 are both in §5.5 and both trace to the same semilattice/vector-space
slip, fix them in one pass.

---

## Summary table

| Item | Verdict | Severity |
|---|---|---|
| A1 — falsified queueing threshold shipping in legible-swarm | **CONFIRMED** (algebra redone; identity exact; both falsification instances reproduce) | Highest — live wrong result in the lead outward-facing document, with the fix already booked as owed in `exec5.tex` L155 |
| A6 — `SO_PEERCRED` self-contradiction | **CONFIRMED** (in fact three-way: caveated / solved / still-open) | High — security claim |
| A7 — Neural Rehydration near-duplicate, unsupported | **CONFIRMED** (zero hits in paper1–7; contradicted by paper5, doc1_treatise, review.tex, and its own §7 + figure caption) | High |
| A8 — "mathematically certain" cure boxed as Conjecture | **CONFIRMED** (four registers, plus a fifth `\VISION` row; paper3 supplies the closed theorem and both number pairs) | Medium-high — an unforced downgrade of a result already in hand |
| A9 — sheaf-Laplacian spectral-gap claim unsupported | **CONFIRMED** (+ the object is undefined over the section's own semilattice sheaf; contradicts Appendix A's "no hard delivery bound") | Medium |
| A10 — boxed "iff" conflates cochain with cohomology group | **PARTIALLY-CONFIRMED** (math error real; whitepaper's own scope rider already states the correction) | Medium — cheap fix, same pass as A9 |
