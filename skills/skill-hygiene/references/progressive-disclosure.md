# Progressive Disclosure For Skill Bundles

A skill is a context-loading machine. The agent reads SKILL.md once, then
loads more material on demand based on the situation. The shape of that
on-demand load is what "progressive disclosure" means.

## The Three-Tier Pattern

```
SKILL.md                               # Tier 1: triggers + index
└── <subdir>/INDEX.md                  # Tier 2: when-to-load table
    └── <subdir>/<leaf>.md             # Tier 3: actual content
```

- **Tier 1 — SKILL.md**: high-frequency procedure, a small decision table,
  and a "Bundled Assets" section pointing at every Tier-2 INDEX. Should fit
  in a few screens; an agent reads this every time the skill activates.
- **Tier 2 — INDEX.md**: a short table mapping "trigger / situation" to
  "leaf file." One row per file in the directory. Loaded only when SKILL.md
  routes the agent to that subdirectory.
- **Tier 3 — leaf docs**: the actual content. Loaded only when an INDEX row
  matches the situation. Usually 1–3 of these load per task.

## Why It Works

Without progressive disclosure, an agent must either:

- Pre-load the entire bundle (expensive, often exceeds context budget), or
- Pick at random (misses content).

With progressive disclosure, the agent loads ~SKILL.md size + ~1 INDEX +
~1–2 leaves per task — typically 5–10× less context than the bundle's full
size, while still reaching the right content.

## The "Trigger / Open This" Pattern

Both SKILL.md's Bundled Assets section and every INDEX.md should follow the
same shape:

```markdown
| Trigger | Open this |
|---|---|
| <observable situation> | `<file or subdir>` |
```

Triggers should be:

- **Concrete and observable** ("`pd <anything>` returns connection refused")
  not abstract ("daemon issues").
- **Mutually exclusive when possible** so the agent doesn't agonize over
  which row applies.
- **In the agent's voice** ("you hit X" / "you're about to Y") rather than
  the author's voice ("this document explains Z").

## When To Add A New Tier

If a directory grows past ~7 files and several of them serve a related
sub-topic, consider a sub-INDEX. Example:

```
scripts/INDEX.md                       # Tier 2
└── scripts/prologue/INDEX.md          # Tier 3 (sub-index)
    └── scripts/prologue/<file>.sh     # Tier 4 (leaf)
```

The auditor handles arbitrarily deep nesting — it walks every INDEX.md it
finds.

## What NOT To Do

- Don't put leaf content in SKILL.md. SKILL.md is a router, not the docs.
- Don't put triggers in leaves. Triggers go in INDEX.md so the agent decides
  whether to load before paying the read cost.
- Don't omit INDEX.md "because the directory only has 2 files." It's still
  cheap, and it future-proofs the bundle.
- Don't write INDEX.md as a list of "files in this directory." The point is
  matching situations to files, not enumerating them.

## How The Auditor Reads This Pattern

The `audit_skill_bundle.py` script assumes:

- SKILL.md exists at the bundle root.
- Each top-level subdirectory may have an `INDEX.md`.
- Reachability = mentioned by basename in SKILL.md or any INDEX.md.

If your skill uses a different pattern (e.g. a single FLAT.md instead of
SKILL.md + INDEXes), the auditor won't be useful — but you should ask
whether the flat pattern is buying you anything that justifies the lost
progressive disclosure.
