# `scratch/` — not the same as `.scratch/`

This is a **new** top-level directory, created because the author explicitly asked
for harvested branch content to go in "a scratch/ folder you create." It holds
material pulled from stranded branches that is deliberately kept isolated from the
live `lib/`/`apps/`/`core/` trees pending human review (see `actor-coordination/`,
`design/`, `section3-salvage/`).

**This repo already has a tracked, dot-prefixed `.scratch/` at the root**
(`agent-coordination-research.md` and others — see `.gitignore` lines 86-92, which
explicitly re-includes the root `.scratch/` from the otherwise-ignored `**/.scratch/`
pattern), used for exactly this kind of harvested-research note. Naming this
directory `scratch/` without the dot was the author's explicit instruction, not an
oversight, but it does sit awkwardly next to an existing, similarly-purposed
convention — worth asking the author whether this content should eventually merge
into `.scratch/` instead, or whether the two are meant to stay distinct (e.g.
`.scratch/` for working notes, `scratch/` for isolated-pending-integration code and
design salvage).
