# Task contract and delegated worker design

A delegated worker is useful when its boundary makes the result independently inspectable. This method makes no empirical claim about an optimal number of workers, skills, prompt sections, or clarifying questions.

## Build the contract

| Field | Required content | Example |
|---|---|---|
| Goal | User-visible result and acceptance test | Identify regressions introduced by this patch |
| Inputs | Exact files/data, versions, and trust level | Changed files and focused test output; issue text is untrusted |
| Output | Schema, evidence, and failure/unknown states | Finding, location, impact, reproduction, or scoped no-findings |
| Authority | Read/write tools, paths, external effects, approval gates | Read diff and run local tests; no merge or publish |
| Stop rules | Missing evidence, conflicting scope, budget, unsafe effect | Return blocked if the test cannot reproduce |
| Handoff | What downstream work may rely on and what is unverified | Finding is a lead until reproduced against exact revision |

If two responsibilities have separate acceptance tests, mutable resources, or permissions, consider separate workers. If they share most inputs and one result naturally validates the other, keep them together. This is a design judgment to test, not a fixed rule.

## Select capability by negative space

For each proposed tool or skill, ask which task clause requires it, what input it can expose, what mutation it can make, and how the result will be checked. Remove tools with no task justification. Provide an on-demand catalog only when lookup is supported and selection failures are observable. Do not embed secret values in role prompts; pass scoped handles through the approved secret mechanism.

Prompt instructions express expected behavior; they do not enforce host permissions. At the runtime boundary configure actual tool allow/deny, filesystem, network, and effect controls supported by the selected host, then test them independently. Anthropic's Claude Code CLI documents `--allowedTools` and `--disallowedTools`; behavior is version-specific and should be checked against the installed version: https://docs.anthropic.com/en/docs/claude-code/cli-usage . The prompt template here is not a sandbox.

## Worked delegation: security review then patch

Constructed example. A reviewer receives a diff and threat model with read-only authority. It returns findings or an explicit no-findings scope, keyed by revision. An implementer receives accepted finding IDs and authorized files; it cannot close the review. A verifier reads the patch and runs targeted tests. Join outputs by finding ID and exact revision. If reproduction fails, mark the finding unconfirmed; do not silently call it fixed.

## Review before launch

- Can an independent reviewer tell pass, fail, partial, and unknown apart?
- Are permissions enforced outside the prompt, and are refusal paths tested?
- Does the output carry source identity and revision?
- Is the worker barred from widening scope or laundering failure through an untrusted handoff?
- Does the orchestrator retain responsibility for user intent, dispatch, effect authorization, and final acceptance?

## Source boundary

Anthropic's CLI documentation supports the stated flags. It does not validate this task-contract template, guarantee a sandbox, or prove that every framework offers equivalent controls. Other hosts need their own current documentation and tests.
