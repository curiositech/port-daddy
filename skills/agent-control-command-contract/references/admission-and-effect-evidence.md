# Admission and effect-evidence worked method

This reference turns the ABAC request/evaluation/enforcement split into a local control-command test plan. It is a constructed method example, not an observed Port Daddy trace.

## Source method

NIST SP 800-162 §2.3 describes evaluating attributes of the subject, object/resource, requested operation, and relevant environment against policy. §2.4.3 distinguishes a Policy Decision Point (PDP), which computes the decision, from a Policy Enforcement Point (PEP), which enforces it. §3.3.1 discusses caching as a performance/freshness/security trade-off. The source leaves implementation-specific authority, revocation, and consistency choices to the implementing system; it does not certify this example. See [`evidence-scope.md`](evidence-scope.md) for exact edition and access notes.

Apply that method to a control request by writing the attributes before implementing the handler:

| ABAC role | Constructed command attribute | Admission check |
| --- | --- | --- |
| Subject | `principal_id = operator-17` | Authenticated issuer equals the principal the policy evaluated. |
| Resource/object | `target_run_id = run-42` | Run still belongs to the selected harbor and current body generation. |
| Requested operation | `verb = interrupt`; `scope = run-control` | Grant covers this exact operation and target, not a broader UI category. |
| Environment | `now`, current policy revision, current authority epoch | Grant is unexpired; revision/epoch match what the enforcement boundary currently accepts. |

The attribute names and values are placeholders. A real system must define trusted sources and field-level integrity; schema strings do not authenticate values.

## Positive trace, with evidence layers kept separate

Constructed case:

1. The operator requests `interrupt` for `run-42` with command ID `cmd-9` and expected authority epoch `12`.
2. The PDP reads the current policy and compares subject, resource, operation, expiry, and epoch. It returns `Permit` for this request.
3. The PEP rechecks/enforces that exact decision at admission and records the command ID, profile revision, target generation, expiry, and epoch.
4. The adapter reports `delivered`. This proves only that the declared receiver channel accepted a command record.
5. The body reports `acknowledged`. This is still a body report, not independent effect proof.
6. A separately controlled observer reads the same target generation and records a state change tied to `cmd-9`; only then may this fixture say `effect-observed` for that scoped effect.

Do not collapse steps 4–6 into one green check. The actual result must preserve source identity and revision for each evidence item.

## Negative fixtures

| Fixture input | Required admission/observation result | Why |
| --- | --- | --- |
| Principal is `operator-18` but grant binds `operator-17` | `policy-denied`; no dispatch | Subject mismatch. |
| Selected row points to `run-42`, current authority resolves `run-43` | `policy-denied` or target-changed; no dispatch | Read-model selection does not rebind authority. |
| Grant scope is `checkpoint`, request is `kill` | `policy-denied`; no dispatch | Operation mismatch. |
| Policy changed after client cached its row | Re-evaluate current policy; deny if new rules do not allow | NIST describes freshness as a policy/implementation consideration, not a property of an “authoritative” label. |
| Grant expired before command delivery and delivery evidence confirms no send | `expired-before-delivery` | Known not delivered. |
| Command may have been delivered; observer times out | `outcome-unknown`, reconcile before retry | Timeout does not prove that the effect failed or did not happen. |
| Epoch 11 arrives after current authority advances to 12 | Reject stale fencing epoch at the enforcement boundary | Event recency alone does not make old authority current. |
| Backend has no command channel for this verb | `unsupported` before dispatch | Capability absence is not a policy denial or execution failure. |

These rows specify expected test outcomes; they are not test results. The static auditor verifies only that a profile declares the distinctions.

## Make the local fixture executable

For each real adapter, create isolated test cases that capture:

- input command and unique ID;
- principal, target, scope, policy revision, expiry, and epoch resolved at admission;
- allow/deny decision plus the PEP dispatch or no-dispatch record;
- delivery acknowledgement separately from any body acknowledgement;
- independent observer source, target generation, and read-back revision;
- unknown outcome and reconciliation behavior when transport/observation is lost;
- duplicate, replay, restart, and authority-epoch regression behavior.

An adapter can have both correct policy and incorrect effect logic. Conversely, an effect can occur even when no acknowledgement arrives. Keep those observations separate in the test oracle, receipts, and UI labels.
