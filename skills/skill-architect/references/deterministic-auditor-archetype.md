# The Deterministic-Auditor Skill Archetype

**Read when** the skill you are building is a *design/decision discipline with quality gates* —
"is this architecture/plan/contract sound?" — rather than a how-to. The archetype turns the
skill's Quality Gates into a runnable, fail-closed scorer so the discipline is machine-checkable,
not just prose an agent can nod along to and ignore.

This is the shape of the port-daddy first-party skill family (`agentic-app-architecture`,
`agent-pr-authoring`, `sqlite-durable-agent-state`, `sandboxed-adversarial-test-harness`, …). If
your skill produces a *spec/plan/design that could be right or wrong against known failure modes*,
build it as a deterministic auditor.

## When it applies (and when it doesn't)

```
Is the skill's core deliverable a design/plan/contract that can be scored against
known failure modes?
├── Yes → deterministic-auditor archetype (this doc)
│         e.g. "is this PR ready to land", "does this sandbox contain an adversary",
│              "does every Articles-of-Agreement clause map to an enforcement mechanism"
└── No  → a normal how-to / reference skill
          e.g. "how to capture a screenshot without stealing focus", a stockpile of
          WGSL snippets, an elicitation method — nothing to score.
```

If you cannot write a script that reads a JSON description of the deliverable and returns a
pass/fail with findings, this archetype does not fit — do not bolt a Potemkin scorer onto a
how-to skill just to match the pattern.

## Anatomy — the four critical parts

1. **`SKILL.md`** — the decision framing: Use / Don't-Use, a Mermaid decision flow, a numbered
   process, an Output Contract naming the spec fields, and **exactly 3 anti-patterns** in
   Novice / Expert / Detection form. Each anti-pattern's **Detection line names the finding `id`
   the script emits** (`Detection: fires \`admin-bypass-skips-required-gate\` (critical) when …`).
   That wiring is what keeps the prose and the scorer from drifting apart.
2. **`scripts/<verb>_<noun>.mjs`** — the scorer. A pure `export function audit<Thing>(spec)` that
   throws `Error` on non-object / malformed input and returns
   `{ pass, findings, recommendations }` (add a numeric `score` or per-axis coverage if it fits).
   Standard CLI tail (see `templates/auditor-skill.mjs`): missing `--input` → usage on stderr +
   exit 1; wrap the run in try/catch. Stdlib only (`node:fs`/`node:path`/`node:url`), no deps.
3. **`schemas/<thing>.schema.json`** — draft-07 schema describing the `--input` spec.
4. **`examples/sample-input.json`** — a COMPLETE spec the scorer returns `pass:true` on. Commit it;
   the Jest test drives the scorer with it.

## The two rules that make the scorer trustworthy

### Fail CLOSED — never treat "not proven bad" as "safe"

The single most dangerous bug in an auditor is downgrading a critical to a warning on the
*absence* of a failure signal. A required check that is `pending` / `skipped` / `neutral`, or an
**empty** checks array, is **not** green — treat it as failing. Verify the safe condition
positively:

```js
// ❌ fails OPEN: a pending/skipped required check, or no checks at all, reads as safe
const safe = !checks.some((c) => c.required && c.status === 'failure');

// ✅ fails CLOSED: safe only when there is ≥1 required check AND every one is proven green
const required = checks.filter((c) => c.required && !c.external);
const safe = required.length > 0 && required.every((c) => c.status === 'success');
```

(This exact regression was caught by security review on `agent-pr-authoring`'s admin-bypass
classifier — a scorer that blesses "not-yet-green" is worse than no scorer, because it launders a
bypass as approved.)

### Findings are structured, and their `id`s are the contract

`pushFinding` writes `{ severity, id, message }` — never free text the caller has to parse.
Severities: `critical` (forces `pass=false`), `high`, `medium`, `low`. `pass` is
`!hasCritical && score >= threshold`. The `id`s are a stable vocabulary the SKILL.md Detection
lines, the README, and any downstream tooling all reference — pick them like API names and don't
rename them casually.

## No keyword-NLP in the scorer

Score **structured fields you control** (enums, booleans, counts, declared arrays), never
substring/keyword matching over free prose. If a check needs to reason about natural-language
content, that is a signal the spec is under-structured — add an explicit field the author fills in.

## Testing the scorer (Jest, repo convention)

Every auditor skill gets a case in a `tests/unit/*.test.js` suite that asserts, per skill:

- `audit<Thing>(sample)` → `pass:true`, `findings` empty;
- a deliberately-weak (schema-valid but policy-violating) spec → `pass:false` with findings;
- `audit<Thing>(null)` and `audit<Thing>('x')` → throw.

Import the module via `pathToFileURL(path).href` (raw absolute-path specifiers break on Windows).

## Repo exemplars (copy these, don't reinvent)

- `skills/agentic-app-architecture/scripts/agentic_app_audit.mjs` — per-axis coverage + fail-closed.
- `skills/agent-pr-authoring/scripts/pr_readiness.mjs` — severity weighting, conditional criticals,
  the fail-closed admin-bypass classifier.
- `skills/sandboxed-adversarial-test-harness/scripts/containment_audit.mjs` — coverage-by-threat.

Skeletons to start from: `templates/auditor-skill.mjs` and `templates/auditor-spec.schema.json`.
