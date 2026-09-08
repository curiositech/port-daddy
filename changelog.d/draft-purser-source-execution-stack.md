### Fixed

- Purser prepares a disposable checkout at the reviewed PR head before fresh authoring and offers bounded, provider-neutral source inspection. New implementation imports resolve against the head, not the base tree.
- Test publication requires consistent execution evidence and successful sandbox cleanup. Tests descend from the reviewed implementation; the original PR's base and existing test branches are preserved.
- GitHub fetch credentials no longer remain in sandbox origin URLs or reach checkout, installs or tests. Default Jest execution disables install lifecycle scripts and bypasses npm test hooks.
- One bounded import-only repair may address an executed loader failure without changing assertions. Missing sandbox/toolchain capabilities, harness failures and branch collisions request attention instead of publishing unverified tests.

Deployment remains held under the operator shutdown order. Native/package-specific execution and live notification delivery are not claimed as validated.
