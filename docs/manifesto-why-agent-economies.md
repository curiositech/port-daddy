# A Profit Incentive for Solving Anything

*Software learned to hire its own help. Here is what happens next, why a harbor has
to come first, and the seven papers that work it out.*

---

![A blueprint drawing of a small harbor: a row of friendly robot tugboats, each tied to its own numbered berth, with the harbor-master's office on the pier.](/img/manifesto/hero-harbor.png)

## Software that hires help

For seventy years, a program did exactly what it was told and nothing more. You
wrote the steps; it ran the steps. If you wanted it to do something new, you wrote
new steps.

<!-- sidenote: Agent -->
A program you hand a *goal* instead of *steps*. It plans the steps itself and can
act in the world — run code, move money, change files. The shift that makes
everything in this document necessary.

That changed. A new kind of program — an **agent** — can be handed a goal instead
of steps. "Fix this bug." "Answer these emails." "Book the cheapest flight." It
works out the steps itself, and it can act in the real world: write and run code,
move money, send mail, change files on your computer. One person at a laptop can
now start a dozen of these at once, each on a different piece of the job, all at the
same time.

This is genuinely useful, and wanting more of it is the most reasonable thing in
the world. If one helper is good, ten are better. So people open ten.

And then they meet the problem this whole document is about.

## The problem is not the helpers. It's that nobody runs the dock.

Picture hiring five contractors to renovate a house and leaving for the day without
a foreman. You come back to find two of them painted the same wall different
colors, a third threw out a ladder the fourth still needed, and the fifth
"finished" the kitchen by hiding the unfinished parts behind a cabinet. None of
them did anything crazy. Each did reasonable work. They just never knew about each
other, so the work collided.

Software agents collide the same way, and the collision is brutal because it is
invisible. Here is the one everyone who has tried this has lived through:

> Two agents start a minute apart. Both decide the same file is where the job is.
> Both read it, both think, both save. **The second save erases the first.** An
> hour of good work is gone — and the result *looks* finished, so nobody notices
> until the thing it quietly broke fails a week later.

![Two robot tugboats lunging for the same berth and grinding together, cargo tipping overboard, the pier behind them empty — no harbor-master, no logbook.](/img/manifesto/collision.png)

The instinct is to fix the helper: a smarter one, a better instruction, a tighter
leash. **That instinct is wrong, and seeing why is the whole point.** You cannot fix
a collision by improving one of the cars.

> **The problem does not live inside any one helper. It lives in the space between
> them — the space where no one is keeping track.**

<!-- sidenote: Tragedy of the commons -->
Garrett Hardin's 1968 name for a shared resource that everyone uses and no one
tends, so it gets wrecked. Ostrom's answer was not a distant ruler or
privatization, but *local rules and records* — exactly what a harbor-master keeps.

This is old ground, just never walked by software. In 1651 Thomas Hobbes argued
that people with no shared referee don't stay civil; they fall into what he called
*bellum omnium contra omnes*, "the war of all against all," and rationally consent
to a single authority because the alternative is worse.[^hobbes] Economists have a
gentler version: a shared resource with no governing institution gets overused and
wrecked — the "tragedy of the commons" — and Elinor Ostrom won a Nobel for showing
the way out is neither privatization nor a distant ruler, but **local institutions
with clear rules and records.**[^ostrom] Your ten agents are a commons. The fix is
not a cleverer commoner. It is the institution.

## A harbor-master

Walk a working harbor and find who is actually in control. Not the biggest ship —
a quiet office on the pier, the **harbor-master**. The harbor-master hands out the
berths, so two ships never claim one slip. Keeps the logbook, so there is one true
record of who came, went, and carried what. Clears who may dock. Nobody resents
this; the harbor-master is why the harbor *works* instead of becoming a pile of
hulls.

**Port Daddy is the harbor-master for the agents on your machine.** It runs quietly
on your own computer — no cloud, no account, nothing leaves your laptop. When an
agent wants a file, it asks Port Daddy first, the way a contractor pulls a permit
before opening a wall. If the file is taken, the second agent waits instead of
stomping the first. That is the whole fix to the 3 a.m. collision: one short
exchange between an agent and the dock.

But a referee that only prevented collisions would be a glorified lock. The reason
you would keep it is the next thing it does.

## Legibility: seeing the whole thing without drowning in it

Run ten agents and your real problem is not collision. It is that you go blind. Ten
streams of activity, hundreds of changes, no way to know what happened without
reading all of it — which defeats the point of having help.

<!-- sidenote: Legibility -->
James C. Scott's term for making a complex thing *readable* by whoever has to
govern it — surveys, maps, standard names. Flatten too far and you destroy the
local know-how (*mētis*) that made the place work. The product is the map; the
failure is the over-flattening.

So the second job of the harbor-master is **legibility**: making a complex thing
*readable* by an authority who has to govern it. The political scientist James C.
Scott traced how states made territory governable exactly this way — surveys,
standardized names, maps — and, crucially, how it goes wrong: a map flattened too
far destroys the local, practical knowledge (he calls it *mētis*) that made the
place work in the first place.[^scott]

> **Legibility is the product. Over-flattening is the failure.**

Port Daddy shows you the swarm as **one picture you can zoom into.** Top level: who
is working, where they disagree, what is stuck, what needs you. See something off,
and you open it — down to the exact change, the exact test, the exact line. The
summary is never a substitute for the truth; it is a map *into* it.

![A clean top-down harbor map with a magnifying glass held over one berth; inside the lens the detail resolves into a tiny schematic and a checklist, while everything outside stays a calm summary.](/img/manifesto/legibility-zoom.png)

And one more job, because you wanted it the first time an agent on your machine
could read every password you own: keep the agents **from hurting you.** A helper
gets a workspace, not the keys to your life — it cannot read your private keys or
your saved logins, and it cannot spend past a limit you set. You should hand a goal
to something clever without lying awake wondering if it will empty your accounts by
morning.

## Why this becomes an economy

Here is the turn that makes this bigger than a tool for programmers.

<!-- sidenote: Reputation -->
A track record you cannot fake, built from durable memory of what an agent
promised and delivered. Derek Parfit argued identity is just psychological
continuity over time; by that test, a memory-bearing agent stops being
disposable and becomes a *worker with a past*.

To referee well, the harbor-master must *remember* — what each agent was doing,
what it promised, what it delivered. Give an agent that memory and a track record,
and what it *is* changes. The philosopher Derek Parfit argued that a person is not a
fixed essence but a chain of psychological continuity over time;[^parfit] by that
test, an agent with durable memory and a history stops being an anonymous,
disposable process and becomes something closer to a worker with a past — a
**reputation.**

The moment you have workers with real, un-fakeable reputations, you have the raw
material of a market. You can tell which helper is actually good — and good *at
what*, because "good" is not one number. Fast is not careful is not tasteful.
Measure it honestly — by judges with no stake in the answer, the way chess rates
players with Elo or the web rates trust with algorithms like EigenTrust[^reputation]
— and you can do things impossible today: trust a helper you did not build, rent a
brilliant one from someone who did, pay only for work checked and found good. A
**profit incentive attached to anything an agent can do.**

<!-- sidenote: Mechanism design -->
The Nobel-winning study (Hurwicz, Maskin, Myerson, 2007) of rules whose *honest*
outcome survives players acting in pure self-interest. It comes with hard limits —
see "You cannot have all three," below — which we take seriously rather than
waving at.

Designing that market is its own science — **mechanism design**, the
Nobel-winning study of rules that stay honest even when everyone games them,[^mech]
and it comes with hard limits (you cannot always have a trade that is efficient,
voluntary, *and* budget-balanced all at once[^ms]). We take those limits seriously
rather than waving at them. But the market is deliberately *last*:

> **No market without trust. No trust without reputation. No reputation without
> memory. No memory without a harbor keeping the logbook.**

So we build the harbor first. The trade comes when the ships do.

## The jewel: seven papers that work it out

![A drafting wall pinned with seven blueprint plates: a back row of three stamped with wax seals ("three prove") and a front row of four showing tugboat schematics ("four explain"), with a small robot studying them.](/img/manifesto/seven-papers.png)

A manifesto is easy. Anyone can promise software will get trustworthy. The hard
part is showing the work — so here it is, as **seven papers.** Not blog posts.
Papers: defined terms, worked examples, and, where we claim something is safe, a
proof a machine checked rather than a feeling we had. (That is **formal
verification** — the same family of tools used to verify the TLS 1.3 protocol that
secures the web, the Signal messaging protocol, and the distributed systems behind
Amazon Web Services.[^formal])

**Four explain the system**, each readable on its own, climbing one ladder from the
machine up to the market:

- **The Legible Swarm** — how a swarm becomes one picture you can zoom into, and
  why that, not raw speed, is the thing worth paying for.
- **The Single-Writer Kernel** — the small, stubborn program at the bottom that
  decides what is *true* — who holds what, who is alive, what really happened — so
  nothing above it has to guess.
- **From Spawn to Person** — how memory turns a disposable process into a worker
  with a track record, and how to measure that record fairly.
- **The Harbor Economy** — the market reputation makes possible: renting trust
  between people who have never met, with money that cannot be quietly stolen in
  the exchange.

**Three more prove it** — the formal companions, where we stop arguing in prose and
hand the claims to proof-checkers. *The Anchor Protocol* proves an agent can prove
who it is with no one to vouch for it. *The Bonded Commons* proves value cannot be
conjured or vanished in a settlement. *The Federated Harbor* proves trust can cross
between machines that do not trust each other, and that a deposit held in the middle
cannot be stolen.

The four explain. The three prove. Together they are the argument that this is
**infrastructure, not a wish.**

## Where to start

You need none of the theory for the first benefit. You need one command, and then
two agents that used to collide take turns instead.

```
brew install curiositech/tap/port-daddy && pd setup
```

The harbor is open. Everything else — the reputation, the market, the profit
incentive for solving anything — gets built on top of a dock that holds.

---

[^hobbes]: Thomas Hobbes, *Leviathan* (1651). The "war of all against all"
(*bellum omnium contra omnes*) and the rational consent to a common authority are
the book's central argument for why coordination requires a sovereign.

[^ostrom]: Elinor Ostrom, *Governing the Commons: The Evolution of Institutions for
Collective Action* (1990); Nobel Memorial Prize in Economic Sciences, 2009. Her
work showed shared resources are best governed by local institutions with clear
rules, monitoring, and records — neither full privatization nor top-down command.
Garrett Hardin's "The Tragedy of the Commons" (*Science*, 1968) named the failure
mode she answered.

[^scott]: James C. Scott, *Seeing Like a State: How Certain Schemes to Improve the
Human Condition Have Failed* (1998). The source of the **legibility** concept used
throughout Port Daddy, and of the warning about destroying *mētis* — local,
practical knowledge — through over-standardization.

[^parfit]: Derek Parfit, *Reasons and Persons* (1984). Personal identity as
psychological continuity and connectedness rather than a fixed essence — the
philosophical basis for treating a checkpointed, memory-bearing agent as a
persistent "person."

[^reputation]: The Elo rating system (Arpad Elo, 1960s) for chess; EigenTrust
(Kamvar, Schlosser, Garcia-Molina, 2003) for reputation in peer-to-peer networks.
On the economics of reputation and why unbounded memory is not always optimal, see
Liu & Skrzypacz, "Limited Records and Reputation Bubbles" (2014).

[^mech]: Mechanism design — Leonid Hurwicz, Eric Maskin, and Roger Myerson shared
the 2007 Nobel Memorial Prize for it. It studies how to design rules whose honest
outcome survives participants acting in pure self-interest.

[^ms]: The Myerson–Satterthwaite theorem (1983): no mechanism for bilateral trade
can be simultaneously efficient, individually rational, and budget-balanced. Any
honest market design must give up one of the three; *The Harbor Economy* names
which.

[^formal]: Formal verification by symbolic analysis and model checking. ProVerif
and Tamarin were used in the analysis of TLS 1.3 and the Signal protocol; TLA+ is
used at Amazon Web Services — see Newcombe et al., "How Amazon Web Services Uses
Formal Methods" (*Communications of the ACM*, 2015). Port Daddy's companion papers
use ProVerif and the Kani model checker.
