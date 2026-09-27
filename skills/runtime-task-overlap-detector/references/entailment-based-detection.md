# Directional NLI features for review

Natural-language inference is directional: a premise may entail, contradict, or be neutral toward a hypothesis. SNLI uses those labels and documents coreference ambiguity. A task record adds deliverable, version, scope, and acceptance facts that NLI does not settle. Mutual entailment is a feature, never `is_overlap`.

## Adapter boundary

Inject an adapter instead of assuming a model, separator token, tokenizer limit, label order, or probability convention. The adapter owns pair encoding and reports truncation/failure.

```js
// Local adapter contract: class probabilities, named labels, complete input.
// The adapter maps provider label order/logits explicitly; this function
// neither guesses that mapping nor renormalizes malformed output.
const classes = ["entailment", "contradiction", "neutral"];
function valid(r) {
  if (!r || r.inputStatus !== "complete" || !r.labels) return false;
  const values = classes.map(label => r.labels[label]);
  return values.every(v => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1)
    && Math.abs(values.reduce((a, b) => a + b, 0) - 1) <= 1e-6;
}
async function directionalFeatures(nli, a, b) {
  if (typeof a !== "string" || !a.trim() || typeof b !== "string" || !b.trim())
    return { status: "unknown-nli-input" };
  try {
    const [aToB, bToA] = await Promise.all([
      nli.score({ premise: a, hypothesis: b }),
      nli.score({ premise: b, hypothesis: a })]);
    if (!valid(aToB) || !valid(bToA)) return { status: "unknown-nli-input" };
    const copy = r => Object.fromEntries(classes.map(label => [label, r.labels[label]]));
    return { status: "available", aToB: copy(aToB), bToA: copy(bToA) };
  } catch {
    return { status: "unknown-nli-adapter" };
  }
}
```

This produces six directional class features, no overlap threshold or verdict. The `1e-6` tolerance checks numerical probability normalization only. It is a local interface tolerance, not an empirically calibrated task classifier. The adapter must bound inference time and use the authorized provider/profile; this function does not cancel a hung provider request. Adapter failures, absent fields, nonfinite values and truncation become unknown. A documented tokenizer limit belongs to the adapter; undisclosed truncation becomes `unknown`.

| Relation | Feature interpretation | Task label |
| --- | --- | --- |
| “add schema validation” / “implement runtime validation for accepted payload” | possible support; compare acceptance facts | possible same task |
| “add docs page” / “add migration” | likely neutral | distinct |
| “approve this patch independently” / “author the patch” | related but different purpose | distinct review |
| Text omits version or is truncated | unscorable | unknown |

Keep contradiction, neutral, entailment, adapter error, and truncation in evaluation. Do not collapse neutral into no overlap.

**Primary-source scope.** Bowman et al., [SNLI](https://aclanthology.org/D15-1075.pdf), pp. 1–3 (accessed 2026-09-24), defines the three labels and discusses coreference ambiguity. It does not validate this feature or a production adapter.
