# A Profit Incentive for Solving Anything

*Software learned to hire its own help. Here is what happens next, why it needs a
harbor before it needs anything else, and the seven papers that work it out.*

---

![A blueprint drawing of a small harbor: a row of friendly robot tugboats, each tied to its own numbered berth, with the harbor-master's office on the pier.](/img/manifesto/hero-harbor.png)

## Software that hires help

For seventy years, a program did exactly what it was told and nothing more. You
wrote the steps; it ran the steps. If you wanted it to do something new, you wrote
new steps.

That changed. A new kind of program — people call it an **agent** — can be handed
a goal instead of steps. "Fix this bug." "Answer these emails." "Book the
cheapest flight." It figures out the steps itself, and it can act in the real
world: write and run code, move money, send mail, change files on your computer.
One person at a laptop can now start a dozen of these at once, each working on a
different piece of the job, all at the same time.

This is genuinely useful, and it is the most reasonable thing in the world to
want more of it. If one helper is good, ten are better. So people open ten.

And then they discover the problem that this whole document is about.

## The problem is not the helpers. It's that nobody runs the dock.

Picture hiring five contractors to renovate a house and then leaving for the day
without a foreman. You come back to find two of them painted the same wall
different colors, a third threw out a ladder the fourth still needed, and the
fifth "finished" the kitchen by hiding the unfinished parts behind a cabinet. None
of them did anything crazy. Each did reasonable work. They just never knew about
each other, so the work collided.

![Two robot tugboats lunging for the same berth and grinding together, cargo tipping overboard, the pier behind them empty — no harbor-master, no logbook.](/img/manifesto/collision.png)

Software agents collide the same way, and the collision is brutal because it is
invisible. Here is the one that everybody who has tried this has lived through:

> Two agents start work a minute apart. Both decide the same file is where the job
> is. Both read it, both think, both save. The second save erases the first. An
> hour of good work is gone — and the result *looks* finished, so nobody notices
> until the thing it quietly broke fails a week later.

The instinct is to fix the helper: write a smarter one, give it a better
instruction, put a tighter leash on it. **That instinct is wrong, and seeing why
is the whole point.** You cannot fix a collision by improving one of the cars. The
problem does not live inside any one helper. It lives in the *space between them* —
the space where no one is keeping track.

A philosopher named Thomas Hobbes made exactly this point in 1651, about people. A
crowd with no shared referee, he argued, doesn't stay polite — it ends up fighting
over everything, and everyone is worse off than if they'd agreed to one authority
they all answer to. He was writing about why we have governments. It turns out he
was also writing, four centuries early, about what happens when you run ten agents
on one computer with nothing sitting between them.

So the fix isn't a better helper. It's a referee.

## A harbor-master

Go down to a working harbor and watch who is actually in control. It is not the
biggest ship. It is a quiet office on the pier — the **harbor-master**. The
harbor-master hands out the berths, so two ships never claim the same slip. Keeps
the logbook, so there is one true record of who came and went and what they
carried. Decides who is cleared to dock. Nobody resents this. The harbor-master is
the reason the harbor *works* instead of becoming a pile of hulls.

**Port Daddy is the harbor-master for the agents on your machine.** It runs
quietly on your own computer — no cloud, no account, nothing leaves your laptop.
When an agent wants to work on a file, it asks Port Daddy first, the way a
contractor pulls a permit before knocking down a wall. If the file is taken, the
second agent waits instead of stomping the first. That is the entire fix to the
3 a.m. collision, and it is one short conversation between an agent and the dock.

But a referee that only prevented collisions would be a glorified lock. The reason
you would actually keep it is the next thing it does: it makes the whole swarm
**legible.**

## Seeing the whole thing without drowning in it

Run ten agents and your real problem is not that they collide. It is that you go
blind. Ten streams of activity, hundreds of changes, and no way to tell what
happened without reading all of it — which defeats the point of having help.

Port Daddy shows you the swarm as **one picture you can zoom into.** Top level:
who is working, where they disagree, what is stuck, what needs you. See something
that looks wrong, and you open it — down to the exact change, the exact test, the
exact line. The summary is never a substitute for the truth. It is a map *into* it.

![A clean top-down harbor map with a magnifying glass held over one berth; inside the lens the detail resolves into a tiny schematic and a checklist, while everything outside stays a calm summary.](/img/manifesto/legibility-zoom.png)

There is a discipline hiding in that sentence, and it is the part most tools get
wrong. A map that is too simplified is worse than no map, because it hides the very
detail that mattered. So every summary here has to be a lens you can look
*through*, never a wall you bump into. See the swarm; trust nothing you cannot
zoom into; get pulled in only when something genuinely needs a human.

And one more thing the harbor-master does, because you wanted it the first time an
agent on your machine could read every password you own: it keeps the agents **from
hurting you.** A helper gets a workspace, not the keys to your life — it cannot read
your private keys or your saved logins, and it cannot spend past a limit you set.
You should be able to hand a goal to something clever and not lie awake wondering
if it will empty your accounts by morning.

## Why this becomes an economy

Here is the turn that makes this bigger than a tool for programmers.

To referee well, the harbor-master has to *remember* — what each agent was doing,
what it promised, what it actually delivered. Give an agent that kind of memory and
a track record, and something changes about what it *is*. It stops being an
anonymous, disposable process and becomes something closer to a worker with a
history. A reputation.

The moment you have workers with real, un-fakeable reputations, you have the raw
material of a market. You can tell which helper is actually good — and good *at
what*, because "good" is not one number. Fast is not the same as careful is not the
same as tasteful. Once that is measured honestly, by judges with no stake in the
answer, you can do things that are impossible today: trust a helper you did not
build, rent a brilliant one from someone who did, pay only for work that was
checked and found good. A profit incentive attached to anything an agent can do.

That economy is real and it is coming. But it is deliberately *last*. You cannot
have a market without trust, you cannot have trust without reputation, you cannot
have reputation without memory, and you cannot have memory without a harbor keeping
the logbook. So we build the harbor first. The trade comes when the ships do.

## The jewel: seven papers that work it out

![A drafting wall pinned with seven blueprint plates: a back row of three stamped with wax seals ("three prove") and a front row of four showing tugboat schematics ("four explain"), with a small robot studying them.](/img/manifesto/seven-papers.png)

A manifesto is easy. Anyone can promise that software will get trustworthy. The
hard part is showing the work — and the work is the point, so here it is, as
**seven papers.** Not blog posts. Papers: defined terms, worked examples, and,
where we claim something is safe, an actual proof a machine checked, not a feeling
we had.

They come in two sets. **Four explain the system**, each readable on its own,
climbing one ladder from the machine up to the market:

- **The Legible Swarm** — how a swarm of agents becomes one picture you can zoom
  into, and why that, not raw speed, is the thing worth paying for.
- **The Single-Writer Kernel** — the small, stubborn program at the bottom that
  decides what is *true* — who holds what, who is alive, what really happened — so
  nothing above it has to guess.
- **From Spawn to Person** — how memory turns a disposable process into a worker
  with a track record, and how you measure that track record fairly.
- **The Harbor Economy** — the market that reputation makes possible: renting
  trust between people who have never met, with money that cannot be quietly stolen
  in the exchange.

**Three more prove it.** These are the formal companions — the parts where we
stopped arguing in prose and handed the claims to proof-checking machines, the same
kind of tools used to verify aircraft software and chip designs. *The Anchor
Protocol* proves an agent can prove who it is with no one to vouch for it. *The
Bonded Commons* proves value cannot be conjured or vanished in a settlement. *The
Federated Harbor* proves trust can cross between machines that do not trust each
other, and that a deposit held in the middle cannot be stolen.

The four explain. The three prove. Together they are the argument that this is
infrastructure, not a wish.

## Where to start

You do not need any of the theory to get the first benefit. You need one command,
and then two agents that used to collide will take turns instead.

```
brew install curiositech/tap/port-daddy && pd setup
```

The harbor is open. Everything else — the reputation, the market, the profit
incentive for solving anything — is what gets built on top of a dock that holds.
