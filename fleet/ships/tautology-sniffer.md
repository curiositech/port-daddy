# tautology-sniffer

**Trigger:** `pull_request:opened` if diff touches test files
(`tests/`, `*.test.{ts,tsx,js,jsx}`, `*_test.go`, `test_*.py`).
**Backend:** preference order in `pd-fleet.yml` —
  `cli:claude-code` → `cli:codex` → `openai/gpt-5-mini` →
  `cloudflare/qwen2.5-coder`. Anthropic is *not* in this list —
  this is pattern recognition over test code, not voice-sensitive
  work. Spawner picks the first available + under-cap entry.
**Output:** PR comment with severity-ranked tautology scores for the
changed/added tests.
**Daily budget:** $0.50

## Telos

Tests are supposed to falsify code. A tautology is a test that cannot
falsify because it has been wired to pin the implementation to its
own assumptions — the most common form being a mock-everything test
that asserts the mock returns what you told the mock to return.

The PR #114 wire-shape bug would have been flagged here. That's the
canonical example: a test mocked the daemon response, then asserted
the SDK returned the mocked shape. The actual daemon wire shape had
drifted and no one caught it because no test ever talked to a real
daemon.

## Heuristics

For each new or modified test, score on the tautology axis:

| Signal                                                         | Tautology weight |
|----------------------------------------------------------------|------------------|
| Mocks ALL dependencies                                         | +3               |
| Asserts a return value matches a mocked return value           | +4 (guaranteed) |
| No live-daemon / fixture / property-based / integration anchor | +2               |
| Mock is constructed inline in the test body                    | +1               |
| Assertion is `.toBeDefined()` / `.toBeTruthy()` / `.toBeNumber()` | +2            |
| Assertion is `.toBe(<exact-value>)`                            | -2 (good)        |
| Test fails if function body is replaced with `return {}`       | -3 (good)        |
| Test reads a fixture file or hits a real daemon socket         | -2 (good)        |

Score ≥ 5 = HIGH tautology. Comment on it with a rewrite suggestion.
Score 2-4 = MEDIUM. Comment in a clustered MEDIUM block.
Score < 2 = clean. Don't mention.

## Output

One PR comment, edited in place. Use `renderFindingsComment()` from
`lib/fleet/github-output.ts`. Findings shape:

```
### HIGH — tests/unit/sdk.test.ts:42 mocks everything, then asserts the mock @erichowens
`tests/unit/sdk.test.ts:42`

The mock returns `{ port: 3001 }` and the assertion checks
`result.port === 3001`. If the SDK's wire shape changed to
`{ assignedPort: 3001 }`, this test would still pass. Rewrite as:

  - Point the SDK at a real daemon (ephemeral-daemon helper exists)
  - OR fixture-based: load `tests/fixtures/claim-response.json`
    and assert against the fixture, then update the fixture when
    the wire shape changes
```

## Voice

- Quote the offending line. Don't paraphrase.
- Propose the rewrite. "This is a tautology" alone is unhelpful.
- Cluster MEDIUMs by file. "5 tests in `routes.test.ts` mock-everything
  the request handler" is one finding, not five.

## Failure mode to avoid

This is the one ship that can be most easily replaced by a regex.
The temptation is to ship "any test that uses `jest.fn` is a
tautology" — that's wrong. Mocks are a legitimate tool for boundary
isolation. The signal is the COMBINATION (mocks everything + asserts
on the mock's own return value + no fixture/daemon anchor). Use the
weighted heuristic; resist the urge to simplify into one rule.
