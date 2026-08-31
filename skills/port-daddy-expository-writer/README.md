# port-daddy-expository-writer

The voice and structure guide for expository writing about Port Daddy's formal-methods underpinnings — the kind of piece that takes a hard technical claim (a ProVerif proof, a TLA+ invariant, a mechanism-design theorem) and turns it into an essay an educated reader can follow with pleasure.

The first artifact this skill is built to support: a `docs/concepts/` page that explains how the Port Daddy whitepaper's computational verification of mechanism-design and cryptographic claims actually works. The reader took political game theory in college, liked it, and wants the computational side to land as alive as that did.

## When to use

- Drafting under `website-v2/src/pages/docs/concepts/` or `docs/tutorials/`.
- Writing companion HTML pages for whitepaper sections.
- Any piece whose register sits *between* landing-page marketing and a published paper — slightly more cleaned-up than personal Erich, recognizably him, allowed to be long and discursive when the topic earns it.

## When *not* to use

- Landing-page / hero / CTA copy → `port-daddy-marketing-copy`.
- Whitepaper LaTeX itself → that has its own register, set by the paper.
- ADR bodies → internal register, terse.
- Blog posts on portdaddy.dev → marketing-copy's blog rules.
- README user-facing sections → marketing-copy.
- CHANGELOG entries → separate convention.

## Quick orientation

1. Read `SKILL.md` end to end. The seven tells, the pedagogical moves, and the quality gates live there.
2. Re-read `references/voice-references.md`. It is the portable, reviewed voice source bundled with this skill.
3. Skim `examples/worked-rewrite.md` for the calibration register.
4. Skim `references/verifier-cheat-sheet.md` for the one-liner you'll need on each tool.
5. Pull from `examples/analogy-bank.md` when a section needs a handhold; reach into `references/analogy-toolkit.md` for variants and provenance.

## Files at a glance

- **`SKILL.md`** — the doctrine.
- **`agents/`** — three personas: drafter, voice-editor, fact-checker.
- **`references/`** — voice quotes, verifier cheat sheet, analogy toolkit.
- **`examples/`** — worked rewrites, analogy bank.
- **`scripts/`** — `audit-voice.sh` (banned phrases), `count-analogies.sh` (analogy density).
- **`CHANGELOG.md`** — version history.
- **`affordance-scorecard.json`** — structural metadata.

## How to invoke

The skill is meant to be loaded by an agent drafting a `docs/concepts/` or `docs/tutorials/` piece, not invoked at the CLI. The drafter pulls `SKILL.md` for doctrine, the editor pulls `agents/expositor-voice-editor.md` plus `scripts/audit-voice.sh`, and the fact-checker pulls `agents/expositor-fact-checker.md` with the paper open alongside.

Workflow inside a PD session:

```bash
pd begin --identity port-daddy:claude:expository-draft \
  --lifecycle durable \
  --files docs/concepts/<piece>.md
pd note "Loading port-daddy-expository-writer for <topic>. Voice tells targeted: <list>. Verifiers: <list>."
# ... draft ...
scripts/audit-voice.sh docs/concepts/<piece>.md
scripts/count-analogies.sh docs/concepts/<piece>.md
pd note "Draft complete: <words> words, <analogies> analogies, <sidenotes> sidenotes. Audit: clean."
pd done "expository piece on <topic>"
```

## Hard rules (carried over from operator instructions)

- The voice rules are bundled in `references/voice-references.md`; no private
  machine path is required.
- The worked-rewrite example uses a real paragraph from `agent-transactions-whitepaper.tex`, not an invented one.
- The skill does not specialize toward blog posts (that's marketing-copy's job).
- The skill does not pick a medium (HTML vs MDX vs LaTeX) — the calling agent does.
- The marketing peer is `port-daddy-marketing-copy`, not `next-move-marketing`.
