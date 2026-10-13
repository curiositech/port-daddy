# Evidence and calibration for conflict candidates

## Structural coverage

Record source snapshot, parser and grammar versions, language/build configuration, parse errors, generated-code boundaries, symbol resolution status, and dynamic features. Tree-sitter represents syntax nodes and supports queries; its grammar tree does not itself prove type/name resolution, runtime dispatch, or semantic incompatibility. A missing graph edge or symbol remains `UNKNOWN` unless the analysis establishes coverage.

Classify evidence separately: same-symbol overlap, declaration/signature change, import/reference edge, transitive dependency, textual merge overlap, and unknown/dynamic feature. Rank candidates with transparent rules; do not present a score as probability unless calibrated against adjudicated integration outcomes on the target languages and repositories.

## Outcome validation

Label candidate pairs after integration/build/test or independent review. Include hard negatives with shared files/topics but compatible work, and positive semantic conflicts without textual overlap. Partition by repository or time before threshold tuning. Freeze parser, graph policy, and threshold, then report held-out precision/recall and unknown coverage by language/configuration. Prediction output stays advisory when parse state is stale or incomplete.

Sources: official [Tree-sitter syntax/query docs](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html) and [grammar authoring guide](https://tree-sitter.github.io/tree-sitter/creating-parsers/3-writing-the-grammar.html) support grammar-node/query behavior only. The research pass found no verified source supporting inherited conflict-accuracy percentages.
