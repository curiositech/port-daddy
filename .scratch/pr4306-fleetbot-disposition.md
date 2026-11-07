Fleetbot review disposition: every blocking and concrete correctness finding from this superseded PR has been handled in successor #4394. This is the explicit closeout, not a silent supersession.

### Fixed

- `resolveManifestPath` module-relative fallback: covered by forcing a cwd outside the repository and loading the real repository manifest.
- Incomplete imprint behavior: covered end-to-end; the receipt is written, output says `INCOMPLETE`, no success line is emitted, and the command exits 1.
- `ui.success` on failure: moved behind the missing-required gate.
- Directory read/stat failures: caught and reported in the artifact result instead of crashing; an unreadable real directory is covered.
- Required-missing `missingRequired`: covered directly.
- Help, unknown subcommand, registration/argument parsing, executable-bit enforcement: covered through `handleBatten`, real fixture files, and real chmod modes.
- Large-artifact hashing: changed from whole-file buffering to bounded 1 MiB chunks.
- Present-but-empty optional directories: inspected and covered while remaining non-blocking because the artifact is optional.
- Permission narration: `verify` remains silent/read-only; `imprint` is classified as a notifying write.
- Review proof: #4394 records the exact commands and outcomes: Batten 22/22, full repository 504 suites / 11,090 tests with zero failures, compiled Batten 10/10 cargo, and source-independent Squid smoke with four providers READY.

### Contested with execution evidence

- The `.js` specifier is intentional for this repository's ESM + ts-jest TypeScript resolution. The test module executed successfully in the focused 22/22 run and in the 11,090-test repository run; changing it to a `.ts` specifier would violate the repository import convention.
- The claimed `fs.existsSync` mock does not exist. The suite imports the real `node:fs` functions and creates actual durable scratch directories/files with `mkdtempSync`, `writeFileSync`, `mkdirSync`, and `chmodSync`. Those fixtures are what Batten inspects.

### Cross-PR/product disposition

- #3496's Bosun and flat-plus-`bin/` tentacle cargo was integrated into #4394 and validated by the compiled release smoke; #3496 is closed as superseded.
- #4262 remains deliberately separate: it generalizes the release-artifact workflow into the Stevedore/skill surface after the Batten runtime contract lands. #4394 does not duplicate that product lane.
- The manually maintained manifest is now checked against the actual staged compiled release in CI. Broader generation/dependency/compliance proposals are useful follow-up ideas, not correctness blockers for this PR.

Successor: #4394. Closing this branch because its implementation and all actionable review repairs now live there.
