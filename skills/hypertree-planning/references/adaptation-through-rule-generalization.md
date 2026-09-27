# Rule adaptation and example limits

## What may be claimed

HTP’s rules express reusable decomposition patterns within the source task setting. The source compares methods under specific datasets and prompts; those comparisons support only the reported setup. They do not establish distance-independent generalization, universal zero-shot performance, or that examples are no longer useful.

## A finite adaptation check

Use one rule `Trip -> {transport,lodging}` with two inputs: a one-city trip and a two-city trip. For each input, record the instantiated child set, unresolved constraints, and whether a child needs further rule expansion. If the two-city trip requires inter-city transport but the rule does not expose it, add a conditional rule or leave a documented leaf for content work. This is a coverage test, not a model-performance experiment.

## Practical comparison protocol

When comparing a rule library to examples, hold model, retrieval corpus, prompt budget, evaluation set, and acceptance test constant. Report failed cases and rule-authoring cost alongside outcome quality. A rule can improve structural consistency while an example helps select domain facts; neither representation alone certifies correctness.
