# federated-harbor-author

One-screen orientation. The authoritative content is `SKILL.md`.

## What this skill is for

Drafting and iterating sections of **The Federated Harbor**, the third
paper in the Curiositech sequence (after Anchor and Bonded Commons).
The skill governs *how* the paper is written: voice, structure,
section-level decisions, quality gates, and the boundary between
"belongs in this paper" and "belongs elsewhere."

Pairs with `federated-harbor-redteam` (probes what you wrote) and
`federated-harbor-whitehat` (closes what redteam opens). Author
operates in versioned rounds with both.

## Structure

```
federated-harbor-author/
├── SKILL.md                                  # voice rules + decision trees (read first)
├── README.md                                 # this file
├── CHANGELOG.md                              # versioned skill history
├── agents/
│   ├── drafter.md                            # section-level prose owner
│   ├── voice-editor.md                       # seven-tells enforcer
│   └── cross-paper-citation.md               # Anchor/Bonded substitution-form auditor
├── references/
│   ├── cross-paper-dependencies.md           # running dependency table (shared)
│   └── topic-map.md                          # twelve-cluster bibliography map
├── scripts/
│   ├── new-round.sh                          # scaffolds dialogue artifact
│   ├── voice-check.sh                        # banned-phrase + em-dash check
│   └── probe-template.json                   # claim-template JSON schema
└── examples/
    └── section-claim-example.json            # worked §fh-3 claim
```

## Quick start

1. Read `SKILL.md` — voice rules, cardinal sins, decision trees,
   quality gates, shibboleths.
2. Read `references/topic-map.md` — twelve bibliography clusters and
   which §fh-N each one covers.
3. Read `references/cross-paper-dependencies.md` — what your section
   can rely on from Anchor and Bonded, in canonical substitution form.
4. Draft against the `scripts/probe-template.json` schema. The
   `examples/section-claim-example.json` is what a complete claim
   looks like.
5. Run `scripts/voice-check.sh papers/federated-harbor/sections/§N.tex`
   before announcing ready-for-redteam.
6. `pd note --tags author,fh,section,§N,ready-for-redteam` to hand
   off to the redteam fleet.

## What this skill is NOT for

- Drafting Anchor or Bonded text — they have their own author skills.
- Marketing copy, landing-page text, blog announcements.
- Production incident response — that is `SECURITY.md`.
- Voice-only PRs without a falsifiable delta.

## Round cadence

Each round runs:

1. Drafter writes a section. Voice editor passes it. Cross-paper
   citation handler audits the substitution-form dependencies.
2. Drafter sprays `ready-for-redteam:fh:§N`.
3. Redteam probes → whitehat closes → sec-eng-lead writes the
   dialogue artifact at `whitepaper/research/program/rounds/federated-harbor/dialogue-fh-vN-to-vN+1.{json,md}`.
4. Drafter applies the change list to §N. Section version bumps.
   Round closes.

A section is *done* only after surviving one full red/white round
with no carried-over smells from drafter-side issues (voice,
cardinal sins, cross-paper dependencies).
