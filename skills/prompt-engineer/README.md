# Prompt Engineer

Craft, optimize, and debug prompts for large language models: the CLEAR framework, chain-of-thought and few-shot patterns, and a deterministic structural audit that catches the failure modes vibes-based review misses (missing output contract, undelimited untrusted input, no eval criteria, kitchen-sink overload, no refusal behavior).

Use this skill when designing system prompts, optimizing agent instructions, reducing hallucinations, or auditing an existing prompt's structural soundness.

## Quick Start

1. Read `SKILL.md` for the CLEAR framework, optimization techniques, and the 9 anti-patterns.
2. Skim `references/injection-and-safety.md` before embedding any user-supplied or retrieved text in a prompt.
3. Skim `references/eval-criteria-patterns.md` before shipping a prompt with no way to tell if it works.
4. Fill in `templates/output-template.md` for the engineered prompt + rationale + prompt-spec handoff.
5. Build a prompt-spec JSON matching `schemas/prompt-spec.schema.json` and audit it:

```bash
node scripts/prompt_audit.mjs --input <your-prompt-spec>.json
```

6. Compare against `examples/expected-output.md` to see a weak prompt audited, then the same prompt fixed and passing.
