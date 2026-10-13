# URL-shortener fixture

Positive structural graph: `contract` and `choose-storage` have no declared hard edge; `implement` requires the versioned contract artifact (data) and storage decision record (decision); `test` requires the implementation digest; `approve-release` requires the passing test receipt; `deploy` requires the implementation artifact, matching test receipt, and matching approval; `verify` requires deploy receipt. Valid topological layers are `{contract, choose-storage}`, `{implement}`, `{test}`, `{approve-release}`, `{deploy}`, `{verify}`.

Negative hand-check: delete `approve-release -> deploy`. The graph remains acyclic but fails the authority contract. Add `api-spec -> data-model` while also placing them in one parallel layer. The layer violates its declared edge and must be revised.

Subject check: test and approval must name the implementation digest consumed by deploy. A receipt for a different digest fails the declared contract even when topology is unchanged. This is a manual contract check, not a runtime enforcement result.
