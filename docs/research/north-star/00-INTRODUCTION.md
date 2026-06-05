# The Harbor Library — Introduction

*An introduction to the seven papers. Read this first; it is the map. You can
enter any chapter from here, and every chapter tells you which others it leans on.*

---

## The problem all seven papers share

You can now hand a goal to a program and walk away. A **coding agent** takes
"fix this bug" or "ship this feature" and works out the steps itself — reading
files, running commands, opening pull requests. One is useful. The temptation is
obvious: open ten. And the first time you do, on a real codebase, you meet the
problem this whole library is about. Two agents edit the same file and the second
silently erases the first. One "fixes" the tests by deleting them. You come back to
a pile of changes and cannot tell what happened. **More agents made you less sure,
not more.**

That is not a bug in any one agent, and you cannot fix it by writing a smarter one.
It is a *coordination* failure — it lives in the space between agents, where no one
is keeping the record. Thomas Hobbes described the shape of it in 1651: rational
actors with no shared authority fall into a war of all against all, and consent to
a referee because the alternative is worse.[^hobbes] Elinor Ostrom won a Nobel for
the constructive half — shared resources survive when a *local institution* keeps
the rules and the ledger.[^ostrom] These seven papers build that institution for
software agents, and then follow it all the way to its surprising conclusion: an
economy.

## The shape of the library

The library climbs a four-layer stack, from the machine up to the market, and then
proves the load-bearing parts with machine-checked mathematics. **Four papers
explain the system; three prove it.** They are chapters in one book, not seven
separate essays — each names what it assumes from below and what it underwrites
above.

The spine is a single sentence, and it is worth holding onto:

> **Memory makes continuity; continuity makes a person, not a spawn; a person
> accrues a record; a record is reputation; reputation is a tradeable asset; and
> tradeable assets make a market.** Pull out any link and the chain above it
> falls. That is why the harbor comes before the economy, and why memory — not
> cryptography — is the foundation of the whole thing.

## The seven chapters

### The four that explain

**I · The Legible Swarm** *(the L2 layer — legibility and authority)*
The chapter you would read first, and the product a solo developer would pay for
today. Its claim: the operator's real problem is not collision but *blindness*, and
the cure is **legibility** — seeing the whole swarm as one picture you can zoom
into, never a wall of diffs. It takes seriously James Scott's warning that a map
flattened too far destroys the local knowledge that made the place work,[^scott] so
its rule is *every summary is a lens you look through to the real artifact, never a
wall you bump into.* — *Assumes* the kernel below (II). *Underwrites* the
identity and economy above (III, IV).

**II · The Single-Writer Kernel** *(the L0/L1 layers — the daemon and the protocol)*
The small, stubborn program at the bottom that decides what is *true* — who holds
which file, who is alive, what was promised, what actually happened — so nothing
above it has to guess. It is a **single-writer transactional reference monitor**: one
writer, one machine, one durable file, no distributed consensus. It is honest about
its own limits (it survives a process crash; it does not promise to survive a power
cut), and about what its runtime monitor can and cannot do. — *Assumes* nothing;
it is the ground. *Underwrites* every other chapter. *Proved by* the Anchor
Protocol (V).

**III · From Spawn to Person** *(the L3 bridge — identity into reputation)*
The hinge of the library. A **role** ("cartographer") is a job description; a
**person** is a role plus continuity — memory, a checkpoint, a history of outcomes.
Following Derek Parfit, identity is that continuity, not a fixed essence.[^parfit]
And reputation is only as real as the identity it keys on: the *score* (Elo,
Bradley–Terry, EigenTrust[^reputation]) is cheap; the *substrate* it scores over —
witnessed outcomes on an identity that cannot be forged — is the whole game.
Quality is not one number; accuracy, aesthetics, and efficiency are judged
separately, by neutral evaluators with no stake in the answer. — *Assumes*
legibility (I) and non-forgeable identity, which it borrows from the Anchor
Protocol (V) and flags as the keystone the market depends on. *Underwrites* the
economy (IV).

**IV · The Harbor Economy** *(the L3 layer — the market)*
Where it all arrives. Once agents have un-fakeable reputations, you can trust a
helper you did not build, rent a brilliant one from someone who did, and pay only
for work that was checked. The harbor is a **three-sided market** — labor,
rentable agents, licensed skills — settling on one conserving ledger, "three-sided
by design, two-sided until reputation ships." Designing rules that stay honest
under self-interest is **mechanism design**, a Nobel-winning science with hard
limits the chapter refuses to wave away.[^mech][^ms] — *Assumes* reputation (III).
*Proved by* the Bonded Commons (VI) and the Federated Harbor (VII).

### The three that prove

These are not appendices. They are chapters V–VII, where the prose stops and the
proof-checkers start — **formal verification**, the family of tools used to verify
the TLS 1.3 protocol that secures the web, the Signal messenger, and the systems
behind Amazon Web Services.[^formal] Each one discharges a promise the explaining
chapters make.

**V · The Anchor Protocol** — proves an agent can prove *who it is* and *what it is
allowed to do* with no trusted third party, and that delegated authority can only
ever *shrink*. Machine-checked in **ProVerif** and **Kani**. — *Proves* the
identity claims of II and III.

**VI · The Bonded Commons** — proves the economics of the coordinator: why there
should be one at all, and that value can be neither conjured nor vanished in a
settlement. Verified in **TLA⁺**. — *Proves* the conservation law of IV.

**VII · The Federated Harbor** — proves the hardest case: trust crossing between
machines that do *not* trust each other, with revocation that converges in bounded
time and an escrow that cannot steal. **TLA⁺** and **ProVerif**. — *Proves* the
federation of IV; it also names the one keystone still unbuilt — cross-operator
attestation — that the whole market half waits on.

## How to read it

- **"Just tell me what it is."** → the manifesto, then **Chapter I**.
- **"Convince the skeptic."** → **I → II → III → IV**, in order.
- **"Prove it to the cryptographer / the economist."** → the matching proof
  chapter (V / VI / VII).
- **"What's still open?"** → every chapter ends with starred exercises drawn from
  the real open problems; the consolidated list is *The Ledger*.

A working software is not the same as a finished argument, and this library is
honest about the seam between them. Each chapter labels its claims by maturity —
*implemented, partial, specified, proposed* — so you always know whether you are
reading about something that runs today or something we have only proven should.
The harbor runs now. The economy is the thing it was always for.

```
brew install curiositech/tap/port-daddy && pd setup
```

---

[^hobbes]: Thomas Hobbes, *Leviathan* (1651) — the "war of all against all" and the rational consent to a common authority.
[^ostrom]: Elinor Ostrom, *Governing the Commons* (1990); Nobel, 2009. Shared resources are governed by local institutions with clear rules and records. Cf. Hardin, "The Tragedy of the Commons" (*Science*, 1968).
[^scott]: James C. Scott, *Seeing Like a State* (1998) — legibility as the instrument of governance, and the danger of flattening away *mētis* (local practical knowledge).
[^parfit]: Derek Parfit, *Reasons and Persons* (1984) — identity as psychological continuity rather than a fixed essence.
[^reputation]: Elo (1960s) for chess; Bradley–Terry (1952) for paired comparisons; EigenTrust (Kamvar et al., 2003) for networked reputation. On bounded memory: Liu & Skrzypacz (2014).
[^mech]: Mechanism design — Hurwicz, Maskin, Myerson, Nobel 2007 — rules whose honest outcome survives self-interested play.
[^ms]: Myerson–Satterthwaite (1983): no bilateral-trade mechanism is simultaneously efficient, individually rational, and budget-balanced. An honest market gives up one; Chapter IV names which.
[^formal]: Formal verification via symbolic analysis and model checking — ProVerif/Tamarin (TLS 1.3, Signal), TLA⁺ (AWS; Newcombe et al., *CACM* 2015). Chapters V–VII use ProVerif and the Kani model checker.
