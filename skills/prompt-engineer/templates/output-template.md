# Engineered Prompt Handoff Template

Fill in every section before handing the prompt off. Validate the underlying prompt-spec claims with `node scripts/prompt_audit.mjs --input <this-prompt-as-spec>.json` before marking it ready.

````markdown
## Engineered Prompt

<The finished system/user prompt text, ready to paste into the target system.>

## Rationale

- Role: <the specific role/persona stated, and why.>
- Output contract: <what shape/format the prompt demands, and how it's stated.>
- Few-shot examples: <how many, and what each one demonstrates.>
- Guardrails: <what hallucination/scope guardrail was added.>
- Untrusted input handling: <how retrieved/user-supplied content is delimited, or "not applicable — no untrusted input.">
- Eval criteria: <the rubric, golden set, or LLM-judge prompt used to know if this works.>
- Refusal / edge-case behavior: <what the model does for out-of-scope, adversarial, or ambiguous input.>
- Techniques applied / skipped: <which rows of the Optimization Techniques table were used, and which were deliberately skipped and why.>

## Prompt Spec (for scripts/prompt_audit.mjs)

```json
{
  "promptId": "<slug>",
  "targetModel": "<model id>",
  "hasClearRole": true,
  "hasExplicitOutputContract": true,
  "outputFormatSpecified": true,
  "fewShotExamples": 0,
  "guardrailsPresent": true,
  "hasEvalCriteria": true,
  "delimitsUntrustedInput": true,
  "avoidsKitchenSink": true,
  "specifiesRefusalBehavior": true
}
```
````

## Checklist before marking ready

- [ ] Role is specific (domain + persona), not a generic assistant framing.
- [ ] Output contract and concrete format are both stated in the prompt itself.
- [ ] 2-3 few-shot examples included for any format-sensitive task.
- [ ] Every untrusted/user-supplied or retrieved span is wrapped in an explicit delimiter.
- [ ] Guardrail against hallucination/scope creep is present.
- [ ] Eval criteria (rubric, golden set, or LLM-judge prompt) defined before shipping.
- [ ] Refusal/edge-case behavior is explicit, not left as an emergent property.
- [ ] Prompt is not overloaded — essential constraints only, tested for necessity.
- [ ] `node scripts/prompt_audit.mjs --input <spec>.json` returns `pass: true`.
