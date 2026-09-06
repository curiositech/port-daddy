# A Profit Incentive for Solving Anything

*Why agent economies are coming, why they need institutions before they need
features, and the strange category-theory reason the whole thing might print
money. A manifesto for the Port Daddy trilogy.*

---

## Start with the file

Two agents. One file. 3 a.m.

Agent A is halfway through refactoring `auth.ts`. Agent B, spawned by a different
orchestrator forty seconds later, also decides `auth.ts` is where the work is. Neither
knows the other exists. They both read the file, both think, both write. The second
write wins. Agent A's hour of work is gone, and worse — the merge looks *clean*, so
nobody notices until the token-refresh race condition it reintroduced pages someone
on a Tuesday.

You can feel this one in your teeth, because if you have run more than one agent at a
time you have lived it. The reflex is to write a smarter orchestrator, a tighter lock,
a better prompt. That reflex is wrong, and seeing *why* it is wrong is the whole point
of this document.

It is wrong because the file collision is not a bug. It is **economics**. Two
self-interested actors, no shared institution, both reaching for the same scarce
resource — Thomas Hobbes wrote the design doc for this in 1651, and he called the
result *bellum omnium contra omnes*, the war of all against all.[^hobbes] Your agent
swarm is in a state of nature. No amount of cleverness inside one agent fixes a problem
that lives *between* agents.

## Agents are becoming economic actors. They have no economy.

Here is the thing nobody quite says out loud: we are about to have millions of
autonomous software agents that can hold goals, spend money, hire each other, and
produce work of real value — and they are going to do all of it with **none of the
machinery a market needs to not be a knife fight.** No identity you can trust. No way to
post collateral. No settlement. No way to tell a one-shot grifter from a counterparty
with a reputation to protect.

The rails are, suddenly, real. Google shipped an Agent Payments Protocol, then teamed
with Shopify on the Universal Commerce Protocol — Walmart, Target, Visa, and Mastercard
endorsing — so an agent can discover, cart, and check out at any merchant serving a
`/.well-known/ucp` profile; Coinbase shipped x402 so an agent can satisfy an HTTP 402
with a stablecoin; Anthropic's MCP is becoming the substrate agents talk
*over*.[^rails] Two serious economists, Gillian
Hadfield and Andrew Koh, wrote a paper this year literally titled *An Economy of AI
Agents* and meant it.[^hadfield] The plumbing is being laid. The question is whether we
lay any **institutions** under it, or whether we let the agent economy relive the
entire 19th century — the bucket shops, the wildcat banks, the runs — at machine
speed.

That is what Port Daddy is. Not a feature. An institution. The boring, load-bearing,
*deeply unsexy* kind: a permit office and a bonded commons for software agents. And the
reason I wrote three formal papers about something this unglamorous is that
institutions only work if their guarantees are not a matter of opinion.

## The Leviathan you can check

Hobbes's answer to the war of all against all was the Leviathan — a sovereign everyone
submits to *voluntarily*, because the alternative is worse. The instinctive engineer
objection is: I don't want a sovereign in my infrastructure, sovereigns become tyrants.
Correct. So make the sovereign's correctness **a proof instead of a promise.**

That is the trilogy, and each paper is one beam:

- **I — The Bonded Commons** asks the question everyone skips: *why should there be a
  coordinator at all?* It is the economics. Agents post bonds, leave an immutable
  evidence trail, and operate under a conservation law that says value is never created
  or destroyed by surprise — only posted, cleared, or refunded. The Leviathan does not
  decide what you build. It enforces what *cannot* be done.
- **II — The Anchor Protocol** is *how a single agent proves who it is and exactly what
  it is allowed to do* to the local daemon. This is the cryptographic floor —
  capability tokens that attenuate (a token can only ever grant *less* than the token it
  came from), verified with ProVerif under an unbounded-session Dolev–Yao attacker and
  bounded with Kani harnesses over the deployed Rust core. Not "we tested it." *The
  model excludes the class of attack; the harnesses pin the code to the model as far
  as they reach.*
- **III — The Federated Harbor** is what happens when the sovereign is not single —
  your laptop and my laptop, neither one a root of authority for the other. Capability
  transfer across the trust boundary, revocation that gossips between machines with a
  named convergence bound, and a bond posted on my machine that can settle against
  damage measured on yours through an escrow that is *structurally* unable to steal.

Three papers, one arc: **one process → one machine → many machines.** The unglamorous
permit office, proven correct, all the way up.

If that were the whole pitch it would be a good pitch. It is not the whole pitch.

## Now the part that sounds insane

Here is a fact most working engineers have never been handed, and it is one of the most
beautiful in mathematics.

There is a formal object for "an idea." David Spivak and Robert Kent call it an
**olog** — an ontology log — and it is, precisely, a category that models the concepts
and relationships of some domain.[^olog] A protein. A supply chain. A legal argument. A
garment. Each is an olog.

And there is a formal object for "an analogy between two ideas." It is a **functor** — a
structure-preserving map from one olog to another. This is not a metaphor for analogy;
it is the thing Dedre Gentner's entire cognitive theory of analogy was *reaching for*
when she defined analogy as the mapping of relational structure, not surface
features.[^gentner] Functors are analogies with the slack taken out.

Now the kicker, which is a theorem, not a vibe: **structure transports along a functor.**
This is Lawvere's functorial semantics; it is Goguen and Burstall's institution theory,
whose one-line summary is *truth is invariant under change of notation*; it is running
software — Spivak and Wisnesky's CQL provably migrates data and structure across
schemas today.[^transport] If you have a functor from olog X to olog Y, then every
theorem, every algorithm, every clever hack you proved about X is *already true* about
Y. Not "probably." Not "by analogy." All of it. For free.

Sit with the size of that. A functor between the olog of protein folding and the olog
of textile manufacture would mean every result about one is a result about the other.
The person who *finds that functor* is holding an arbitrage — buy a solution cheap in
the domain where it is known, sell it dear in the domain where nobody realized it
applied.

And a market for solving problems efficiently is, definitionally, a market that pays
for exactly this. Ricardo's comparative advantage is the arbitrage's pricing law; Hayek
showed the price system is itself a distributed computer for discovering who can do what
cheapest; and we have hard evidence the incentive works — Karim Lakhani ran an open
prize contest against an in-house NIH team on a real computational-biology problem and
the *market won*, decisively.[^market] DARPA's grand challenges bought roughly a 50×
effort multiplier for the prize money. **A marketplace for solutions is a profit
incentive to discover analogies, which is a profit incentive to solve every problem and
every problem that rhymes with it.** The purest neoliberal fantasy ever — and it is
sitting on top of a 1960s category-theory paper and a hash of a bond. ARBITRAGE, PRINT
MONEY.

Okay. Deep breath. Because if I stopped there, I would be doing the exact thing this
manifesto exists to refuse.

## The honest caveat is the entire load-bearing beam

Here is the sentence that separates this from every breathless thread you have scrolled
past:

> "Theorems transport along a functor" is true. "Finding the functor is easy" is false.
> Finding the functor is the *whole* problem.

Almost every analogy you have ever made is **not a functor.** It is lossy. Category
theory has precise names for the near-misses: a **Galois connection** is an analogy that
approximates in one direction and leaks in the other; a **span** is two ideas that share
only a partial abstraction; and only a true **equivalence** — the kind of total
correspondence that homotopy type theory's univalence axiom makes "transport
*everything*" literal — gives you the dream in full.[^fidelity] "Protein folding →
efficient garments" is almost certainly a leaky span, not a functor, and anyone who
tells you otherwise is selling poetry.

The grounded version of the dream is real but humbler. AlphaFold cracked protein
structure; the *method* — not the artifact — transported to materials discovery, and
DeepMind's GNoME proposed hundreds of thousands of stable crystals.[^alphafold] The
functor there was found by humans, at great cost, and it carried the *technique*, not
the answer. That is what transport actually looks like in the wild: expensive,
partial, and worth a fortune precisely *because* it is expensive and partial.

So the arbitrage is real and the naive version is a casino. The interesting question —
the one I think is genuinely new — is: **what would make it a market instead of a
casino?**

## The bonded commons is the missing market microstructure

A market in analogies is impossible for the same reason a market in lemons is hard: the
seller knows whether their "functor" actually preserves structure, and the buyer does
not. You cannot sell transported solutions if every buyer has to re-derive the
correspondence to check you didn't lie. That is not a market. That is a trust fall.

This is exactly — *exactly* — the problem the Bonded Commons solves, and I did not
realize until I went looking that nobody seems to have connected these two things. The
machinery is already built:

- A claim of analogy is a **capability claim**: "I assert a structure-preserving map
  from X to Y." Anchor already knows how to make such claims unforgeable and
  attenuable.
- The **proof obligation is the product.** You don't sell "a solution from domain X." You
  sell a solution *plus a checkable receipt* — a CQL-style migration, a composition-
  preservation witness — that the transport kept the structure it claims. The receipt is
  the good.
- You **price by categorical fidelity.** A full equivalence is worth more than a faithful
  functor is worth more than a Galois connection is worth more than a bare span. The
  market can grade its merchandise.
- And you **bond it** — honestly about what the bond is for. The receipt is *checkable*:
  a buyer verifies the witness themselves, so no trusted auditor sits in the middle to
  bribe, and that structural check, not the collateral, is what kills the market for
  lemons. The bond is the residual backstop, covering the damage a claim that *passes* the
  check can still do downstream; if the bonded claim turns out to be a leaky span dressed
  up, it is slashed and the conservation law keeps any value from evaporating quietly.
  Sizing that bond — high enough to deter, low enough not to price out honest sellers — is
  its own open problem, not a detail I get to wave past.

That is the whole trick. The boring permit office — bonds, evidence chains, a
conservation theorem, structurally-bounded settlement — turns out to be the missing
**microstructure** for an economy of transported ideas. The thing that makes analogy
arbitrage a market and not a knife fight is the same thing that keeps two agents from
clobbering `auth.ts` at 3 a.m. It is institutions, the whole way down, from the file to
the fantasy.

## Earn the big claim

So: a profit incentive for solving any problem. I believe it. But notice what had to be
true to *earn* the sentence instead of merely shouting it:

1. Agents have to be able to transact at all — identity, capability, settlement —
   without a knife fight. *(Papers I–III.)*
2. A claim that "this solution transports to your domain" has to be **cheap to verify
   and expensive to fake.** *(The bond and the receipt.)*
3. And we have to be ruthlessly honest that the scarce, valuable, market-making thing is
   not the solution and not the marketplace — it is the **verified functor**, and those
   are hard-won. *(The caveat, kept in the load-bearing position where it belongs.)*

Get those three and the fantasy stops being a fantasy and starts being plumbing. Elinor
Ostrom spent a career showing that commons don't need a tyrant *or* a tragedy — they
need rules, monitoring, and graduated stakes.[^ostrom] That is what we are building, for
the strangest commons yet: the space of ideas, traded by machines, priced by how much
structure they actually carry.

It starts, unglamorously, with not losing an hour of work to a file collision. Every
cathedral is buttresses before it is a ceiling.

```bash
brew install curiositech/tap/port-daddy
pd begin --identity myapp:auth --purpose "refactoring token refresh" --lifecycle durable
pd session files claim src/auth.ts
# If another agent reaches for that file, the institution already said no.
```

The Leviathan is not tyranny. It is the reason the market can exist at all.

---

### Notes

[^hobbes]: Thomas Hobbes, *Leviathan* (1651). The war of all against all is the
    canonical argument for why self-interested actors with no shared sovereign
    coordinate badly — the multi-agent file collision, four centuries early.
[^rails]: Google, *Agent Payments Protocol (AP2)*, 2025; Google & Shopify, *Universal
    Commerce Protocol (UCP)*, 2026 (ucp.dev — discovery, cart, checkout for
    agent-mediated retail; authorization proof delegated to AP2's verifiable-credential
    mandates, whose SD-JWT/JWS formats Port Daddy adopts at the harbor boundary in
    ADR-0094); Coinbase, *x402* (HTTP 402 settlement for agents), 2025; Anthropic,
    *Model Context Protocol (MCP)*, 2024. The payment and coordination rails for
    autonomous agents now exist; the institutions under them mostly do not — UCP's own
    security critics (DataDome, 2026) say plainly that it standardizes *how* agents
    transact while leaving *which agents to trust* unsolved.
[^hadfield]: Gillian K. Hadfield & Andrew Koh, *An Economy of AI Agents*, NBER Working
    Paper, 2025 — the serious-economics treatment of agents as economic actors.
[^olog]: David I. Spivak & Robert E. Kent, "Ologs: A Categorical Framework for Knowledge
    Representation," *PLoS ONE* 7(1), 2012. See also Spivak, *Category Theory for the
    Sciences* (MIT Press, 2014).
[^gentner]: Dedre Gentner, "Structure-Mapping: A Theoretical Framework for Analogy,"
    *Cognitive Science* 7(2), 1983. Analogy as the mapping of relational structure — the
    cognitive theory a functor formalizes.
[^transport]: F. William Lawvere, "Functorial Semantics of Algebraic Theories" (1963);
    Joseph Goguen & Rod Burstall, "Institutions: Abstract Model Theory for Specification
    and Programming," *J. ACM* 39(1), 1992; David Spivak & Ryan Wisnesky, functorial data
    migration / CQL (*The Categorical Query Language*) — provable structure transport in
    running software.
[^market]: David Ricardo, *On the Principles of Political Economy and Taxation* (1817),
    comparative advantage; Friedrich Hayek, "The Use of Knowledge in Society," *American
    Economic Review* 35(4), 1945 (the price system as distributed computation); Karim
    Lakhani et al., "Prize-based contests can provide solutions to computational biology
    problems," *Nature Biotechnology* 31, 2013 (an open market beat the in-house team).
[^fidelity]: The Univalent Foundations Program, *Homotopy Type Theory* (2013) — the
    univalence axiom makes "equivalent structures are interchangeable" literal. Galois
    connections and spans are the names for the *approximate* analogies that transport
    only partially; conflating them with functors is where analogy pitches become
    poetry.
[^alphafold]: John Jumper et al., "Highly accurate protein structure prediction with
    AlphaFold," *Nature* 596, 2021; Amil Merchant et al., "Scaling deep learning for
    materials discovery" (GNoME), *Nature* 624, 2023. The *method* transported across
    domains; the artifact did not.
[^ostrom]: Elinor Ostrom, *Governing the Commons* (1990) — commons survive with rules,
    monitoring, and graduated sanctions, not with a tyrant or a tragedy.
