# Executable feedback and bounded repair

The paper’s §3.3 loop has the Engineer write and execute unit tests and debug from its execution history plus PRD/design/code context. The separate QA-mediated example below is a constructed teaching variant.

**Repair protocol.** Choose a fixture that exercises a named PRD requirement. Preserve the implementation version, command or test identity, exact observed output/error, and relevant PRD/design/task context. Return that evidence to the responsible Engineer. The next attempt should identify what changed in response to the observation; rerunning the same assertion without a changed repair is not a diagnosis. Re-execute the fixture and record either the new observed result or a visible unresolved exit when the local repair policy ends.

For example, a test raises `TypeError: Reduce of empty array with no initial value` for the empty-input requirement. QA returns the error, `summarize(rows)` interface, and task identifier; the Engineer adds the missing zero initial value to the reduction; QA records the next fixture result. This is a constructed trace, not a claim about framework execution. The paper describes a three-retry setup; treat it as that experiment's configuration, not a framework rule. A passing finite suite supports only the exercised cases, and does not establish feature completeness, uncovered edge cases, security, or production readiness. [Paper](https://arxiv.org/html/2308.00352v7) §3.3, accessed 2026-09-24.

## Reproducible local failure and repair

This JavaScript fragment demonstrates only the constructed zero-row fixture. `rows` is already-parsed CSV data represented as an array of finite numeric amounts; CSV parsing, invalid rows, floating-point accuracy, and output formatting are outside its contract.

```javascript
const sumBefore = rows => rows.reduce((total, value) => total + value);
// sumBefore([]) throws TypeError: Reduce of empty array with no initial value.
const sumAfter = rows => rows.reduce((total, value) => total + value, 0);
// sumAfter([]) === 0; sumAfter([2, 3]) === 5.
```

A minimal evidence handoff names requirement `R-empty`, design `D-sum-v1`, task `T-sum`, tested implementation `before` or `after`, actual fixture input, actual result, and the changed initial-value argument. An empty array already has a `map` method; claiming that it produces “rows.map is not a function” would be an incorrect example. A passing sum fixture does not certify the CSV exporter.
