# A worked rewrite

The instructive case is not a bad README — it is a *diligent* one. The example below is
composed from a real front door that had been maintained continuously for two years: every
individual edit was correct, every feature listed was real, and the result was unusable.

## Before

```markdown
# ⚓ Port Daddy (v3.28.2)

<p align="center">
  <img src="website-v2/public/img/hero-portdaddy.png" width="600">
</p>

<p align="center">
  <strong>Stop your agents from fighting each other.</strong><br />
  Atomic port assignment, session coordination, pub/sub messaging, sandboxed agent
  spawning, and crash salvage — one daemon, zero config.
</p>

[4 badges, one of which hardcodes a test count]

## Overview
[two paragraphs]
[a code block]
[a paragraph about default daemon URLs]

### ⚓ Key Primitives
[8 bullets]

## 🧭 Table of Contents
[21 entries]

## 📦 Installation
...
```

Measured: 1,046 lines. 43 code fences. 24 top-level sections. A table of contents at line
54, before the reader has seen anything work. A hero image whose file does not exist.

## The diagnosis

Run the identity interview and the failure is immediate.

**Q1, what is this?** The README says: atomic port assignment, session coordination,
pub/sub, sandboxed spawning, salvage. Five nouns joined by commas. The architecture doc of
record says something completely different in structure — one daemon owning one durable
truth, one enforced write boundary, one work-graph, surfaces that are pure projections.

Both are *true*. The README lists what the system has; the architecture doc says what the
system **is**. A reader given the list cannot predict what happens when two agents
conflict; a reader given the structure can predict most of the product. The README was
feature-accurate and identity-wrong — the failure mode that reads worse than being simply
out of date, because the reader is being confidently told the wrong thing.

**Q3, smallest real success?** Buried. The first command is at line 27 but it is a
three-command coordination lifecycle with four flags, which is not a first success — it is
the eleventh thing a user does.

**Q5, what proof?** A hardcoded "tests-7,300+ passing" badge and a broken hero image. The
badge asserts a number no service computes. The image renders as an error icon in the most
prominent position on the page.

## The cuts

The largest single win is not rewriting — it is deleting. Every one of these is real,
correct, and belongs somewhere else:

| Cut | Lines | Where it goes |
|---|---|---|
| Command index (every verb, grouped) | ~30 | `pd help` — generated from the registry, so it cannot drift |
| Destructive-command list (35 entries) | ~40 | `docs/operations/` and the confirmation prompts themselves |
| Permission-tier table + audit-trail prose | ~55 | `docs/operations/permission-tiers.md` |
| Environment-variable reference | ~15 | `docs/reference/configuration.md` |
| Per-feature deep sections (tuples, pheromones, actors, roster, arbiter, booty…) | ~350 | `docs/` pages, one each, linked from the docs map |
| Daemon-operations detail (berths, backup, cut, batten, distribution) | ~65 | `docs/operations/` |
| Every "as of ADR-00XX" aside | scattered | delete; the ADR link carries it |

None of that information is lost. All of it becomes findable instead of scrollable.

## After — the opening

```markdown
# Port Daddy

Run a dozen coding agents at once without them stepping on each other.

[3 live badges]

![Two agents coordinating through the daemon](website-v2/public/gifs/quickstart.gif)

Point ten agents at one repository and they will race: two claim port 3000, two edit the
same file, one dies mid-task and takes its context with it. Port Daddy is a local daemon
that owns one durable record of who is doing what, and refuses any write that does not
pass through it. Agents get their own ports, announce what they are editing, and leave a
trail their successors can pick up. If you run more than one agent at a time, it is for
you. If you run one, you do not need it yet.

## Quick start

    brew install curiositech/tap/port-daddy
    pd setup

Then claim a port and start working:

    $ pd claim myapp
    myapp:default:main → 51847

## How it works

One daemon owns the truth. Everything else is a projection.

[mermaid diagram, six nodes]

Every mutation — a commit, a spawn, a claim, a control command — passes one enforced
boundary that checks identity, capability, and whether you said where the work sits on the
roadmap. It passes, or it refuses loudly. There is no bypass.
```

## The result

| Metric | Before | After |
|---|---|---|
| Lines | 1,046 | ~330 |
| Fences | 43 | 17 |
| Top-level sections | 24 | 10 |
| First runnable command | line 27, an 11th-step workflow | line 22, a first success |
| Hero media | broken path | a recording that already existed in the repo, unused |
| Identity statement | five comma-joined nouns | one sentence a stranger can act on |

## The generalizable moves

1. **Read the architecture doc before the README.** If they disagree on identity, rewrite
   from identity down. Never patch.
2. **Find the media the repo already has.** Projects that generate terminal recordings for
   their marketing site routinely never link one from the README. Check `demos/`, `*.tape`,
   `public/gifs` first — the highest-value asset is usually already built.
3. **Move reference out before rewriting prose.** Cutting 500 lines of tables makes the
   remaining prose problems visible; rewriting prose first means rewriting prose you are
   about to delete.
4. **Ship a deletion in every README PR.** Without a counterweight, a freshness gate
   produces monotonic growth by construction — the cheapest way to satisfy "did you update
   the README?" is always to add something.
