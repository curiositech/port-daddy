"""Offline contract tests. Execute with unittest, never a daemon test harness."""
from copy import deepcopy
import contextlib
import importlib.util
import io
import random
import unittest

from temporal import project, MAX_EVENTS
from consequence import analyze, R17, _source
from fixtures import event, access, analytics, encrypted_replay


def view(events, **overrides):
    """Read a complete synthetic stream with explicit query context."""
    query = dict(tenant="tenant-a", project_id="same-project", principal="alice",
                 access=access(), epoch=1, as_of=max((e["sequence"] for e in events if e["tenant"] == "tenant-a"), default=0), effective_at=100)
    query.update(overrides)
    return project(events, **query)


class TemporalTests(unittest.TestCase):
    def test_deterministic_replay_without_mutation(self):
        records = analytics()
        before = deepcopy(records)
        self.assertEqual(view(records), view(records))
        self.assertEqual(records, before)
        self.assertFalse(view(records)["effectAuthority"])

    def test_bitemporal_backdated_exception(self):
        records = analytics()
        def scopes(**query):
            return next(e for e in view(records, **query)["records"] if e["id"] == "e2")["data"]["scopes"]
        self.assertEqual(scopes(as_of=2, effective_at=20), ["transactions", "analytics"])
        self.assertEqual(scopes(as_of=3, effective_at=5), ["transactions", "analytics"])
        self.assertEqual(scopes(as_of=3, effective_at=20), ["transactions"])
        self.assertEqual(scopes(as_of=3, effective_at=10), ["transactions"])

    def test_stale_actor_belief_is_not_rewritten_as_policy(self):
        state = view(analytics())
        assertion = next(e for e in state["records"] if e["kind"] == "assertion")
        self.assertEqual(assertion["principal"], "stale-agent")
        self.assertEqual(assertion["data"]["proposition"], "No extra database is ever permitted")
        self.assertNotIn(assertion["data"]["proposition"], analyze(state, [])["derivations"])

    def test_acknowledgment_does_not_accept_commitment(self):
        state = view(analytics(), as_of=6)
        self.assertEqual(len(state["acknowledgments"]), 1)
        self.assertEqual(state["commitments"]["e5"]["state"], "proposed")
        self.assertNotIn("commitment-active:e5", analyze(state, [])["derivations"])

    def test_departure_preserves_accepted_commitment_and_debtor(self):
        state = view(analytics() + [event(10, "participation", {"state": "departed"})])
        self.assertEqual(state["participation"]["alice"], "departed")
        self.assertEqual(state["commitments"]["e5"]["state"], "accepted")
        self.assertEqual(state["commitments"]["e5"]["debtor"], "alice")

    def test_successor_cannot_accept_for_another_debtor(self):
        records = analytics()
        records[6]["principal"] = "stale-agent"
        with self.assertRaisesRegex(ValueError, "INVALID_COMMITMENT_TRANSITION"):
            view(records)

    def test_refusal_is_not_assent(self):
        records = analytics()[:7]
        records[6]["data"]["state"] = "refused"
        self.assertEqual(view(records)["commitments"]["e5"]["state"], "refused")

    def test_beneficiary_can_cancel_but_debtor_cannot_silently_cancel(self):
        change = event(10, "transition", {"target": "e5", "state": "cancelled", "receipt": "cancel-declaration"}, principal="bob")
        self.assertEqual(view(analytics() + [change])["commitments"]["e5"]["state"], "cancelled")
        self.assertFalse(analyze(view(analytics() + [change]), ["remove-clickhouse"])["conflict"])
        change["principal"] = "alice"
        with self.assertRaisesRegex(ValueError, "INVALID_COMMITMENT_TRANSITION"):
            view(analytics() + [change])

    def test_fulfillment_requires_named_visible_oracle_evidence(self):
        receipt = event(10, "evidence", {"atom": "analytics-test-passed"})
        close = event(11, "transition", {"target": "e5", "state": "fulfilled", "receipt": "e10"}, basis=["e10"])
        self.assertEqual(view(analytics() + [receipt, close])["commitments"]["e5"]["state"], "fulfilled")
        receipt["data"]["atom"] = "irrelevant-test"
        with self.assertRaisesRegex(ValueError, "MISSING_ORACLE_RECEIPT"):
            view(analytics() + [receipt, close])

    def test_duplicate_is_idempotent_but_rewritten_duplicate_fails(self):
        records = analytics()
        self.assertEqual(view(records), view(records + [deepcopy(records[0])]))
        duplicate = deepcopy(records[0]); duplicate["data"]["atom"] = "changed"
        with self.assertRaisesRegex(ValueError, "IDEMPOTENCY_CONFLICT"):
            view(records + [duplicate])

    def test_replay_rejects_gap_reorder_unknown_epoch_and_schema(self):
        mutations = [
            (lambda r: r.pop(2), "SEQUENCE_GAP_OR_REORDER"),
            (lambda r: r.reverse(), "SEQUENCE_GAP_OR_REORDER"),
            (lambda r: r[0].update(version=2), "UNKNOWN_SCHEMA"),
            (lambda r: r[0].update(epoch=2), "UNSUPPORTED_EPOCH_HANDOFF"),
            (lambda r: r[0].update(kind="made-up"), "UNKNOWN_EVENT"),
            (lambda r: r[0].update(basis=["e2"]), "UNKNOWN_OR_FORWARD_REFERENCE"),
            (lambda r: r[1].update(recordedAt=0), "RECORDED_TIME_REORDER"),
        ]
        for mutate, message in mutations:
            with self.subTest(message=message):
                records = analytics(); mutate(records)
                with self.assertRaisesRegex(ValueError, message):
                    view(records)

    def test_incomplete_future_query_fails(self):
        with self.assertRaisesRegex(ValueError, "INCOMPLETE_PREFIX"):
            view(analytics(), as_of=10)

    def test_structured_limits_and_malformed_types(self):
        cases = [("sequence", True), ("validUntil", -1), ("data", {"atom": "x", "extra": True}), ("audience", ["alice", "alice"])]
        for key, value in cases:
            records = analytics(); records[0][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                view(records)
        with self.assertRaisesRegex(ValueError, "EVENT_LIMIT"):
            view([event(i, "evidence", {"atom": "a"}) for i in range(1, MAX_EVENTS + 2)])

    def test_exception_cannot_widen_scope(self):
        records = analytics(); records[2]["data"]["scopes"] = ["other-project"]
        with self.assertRaisesRegex(ValueError, "EXCEPTION_SCOPE_WIDENING"):
            view(records)

    def test_tenant_isolation_with_identical_object_and_project_ids(self):
        records = analytics()
        other = deepcopy(records)
        for e in other:
            e["tenant"] = "tenant-b"
            if e["kind"] == "evidence":
                e["data"]["atom"] = "tenant-b-only"
        self.assertEqual(view(records), view(other + records))

    def test_current_revocation_blocks_old_views(self):
        with self.assertRaisesRegex(ValueError, "NOT_AUTHORIZED"):
            view(analytics(), as_of=2, access=access(revision=2, readers=["bob"]))
        for policy in [access(tenant="tenant-b"), access(project="other-project")]:
            with self.assertRaisesRegex(ValueError, "NOT_AUTHORIZED"):
                view(analytics(), access=policy)

    def test_hidden_source_and_its_derivative_do_not_leak(self):
        records = encrypted_replay()
        records[0]["audience"] = ["bob"]
        before = view(records)
        records[0]["data"]["atom"] = "different-private-fact"
        self.assertEqual(before, view(records))
        self.assertEqual(before["records"], [])

    def test_invalidation_challenges_support_without_repealing_policy_or_commitment(self):
        records = analytics() + [event(10, "invalidate", {"target": "e1"})]
        state = view(records)
        assertion = next(e for e in state["records"] if e["kind"] == "assertion")
        norm = next(e for e in state["records"] if e["kind"] == "norm")
        self.assertEqual(assertion["support"], "current")
        self.assertEqual(norm["support"], "invalidated")
        self.assertEqual(norm["data"]["scopes"], ["transactions"])
        self.assertEqual(state["commitments"]["e5"]["state"], "accepted")
        with self.assertRaisesRegex(ValueError, "INVALIDATED_PREMISE"):
            analyze(state, ["remove-clickhouse"])
        self.assertEqual(len(view(records, as_of=9)["records"]), 9)

    def test_erasure_prevents_historical_payload_resurrection(self):
        records = analytics() + [event(10, "erase", {"target": "e1"})]
        self.assertEqual(view(records, as_of=2)["records"], [])

    def test_invalidated_exception_or_acceptance_cannot_produce_a_clear_analysis(self):
        for target in ["e3", "e7"]:
            with self.subTest(target=target):
                state = view(analytics() + [event(10, "invalidate", {"target": target})])
                self.assertEqual(state["commitments"]["e5"]["state"], "accepted")
                with self.assertRaisesRegex(ValueError, "INVALIDATED_PREMISE"):
                    analyze(state, [])

    def test_expired_source_hides_derivatives(self):
        records = encrypted_replay(); records[0]["validUntil"] = 10
        self.assertEqual(len(view(records, effective_at=10)["records"]), 3)
        self.assertEqual(view(records, effective_at=11)["records"], [])


class ConsequenceTests(unittest.TestCase):
    def test_seeded_adapter_cases_match_existing_independent_oracle(self):
        rng = random.Random(20260908)
        atoms = [f"a{i}" for i in range(5)]
        for case in range(100):
            facts = rng.sample(atoms, 2)
            records = [event(i + 1, "evidence", {"atom": atom}) for i, atom in enumerate(facts)]
            horn = [(tuple(rng.sample(atoms, rng.randrange(3))), rng.choice(atoms + [R17.BOT])) for _ in range(6)]
            for body, head in horn:
                records.append(event(len(records) + 1, "rule", {"body": list(body), "head": head}, basis=["e1"]))
            norms = []
            for _ in range(3):
                modality, action, scope = rng.choice(["O", "F"]), rng.choice(["act0", "act1"]), rng.choice(["s0", "s1"])
                records.append(event(len(records) + 1, "norm", {"modality": modality, "action": action, "scopes": [scope]}, basis=["e1"]))
                norms.append(((), modality, action, (scope,), (100, 100), records[-1]["id"]))
            policy = {"facts": set(facts), "horn": horn, "deontic": norms, "claims": [], "nvars": 0, "cons": []}
            with self.subTest(case=case):
                self.assertEqual(analyze(view(records), [])["conflict"], R17.oracle(policy, atoms)["conflict"])

    def test_existing_checker_import_has_no_experiment_side_effect(self):
        spec = importlib.util.spec_from_file_location("r17_import_test", _source)
        with contextlib.redirect_stdout(io.StringIO()) as output:
            spec.loader.exec_module(importlib.util.module_from_spec(spec))
        self.assertEqual(output.getvalue(), "")

    def test_cross_artifact_consequence_has_a_full_premise_path(self):
        result = analyze(view(analytics()), ["remove-clickhouse"])
        self.assertTrue(result["conflict"])
        self.assertEqual(set(result["witnesses"][0]["premises"]), {"e1", "e8", "e9", "e5", "e7", "hypothetical-action:remove-clickhouse"})
        self.assertFalse(result["effectAuthority"])

    def test_ciphertext_storage_does_not_imply_decryption(self):
        self.assertFalse(analyze(view(encrypted_replay()), ["store-ciphertext-remotely"])["conflict"])
        self.assertTrue(analyze(view(encrypted_replay()), ["server-decrypt"])["conflict"])

    def test_circular_rules_do_not_supply_their_own_premises(self):
        records = [event(1, "rule", {"body": ["b"], "head": "a"}), event(2, "rule", {"body": ["a"], "head": "b"})]
        self.assertEqual(analyze(view(records), [])["derivations"], {})

    def test_consequence_limit_is_not_a_conflict_free_answer(self):
        with self.assertRaisesRegex(ValueError, "CONSEQUENCE_BOUND_EXCEEDED"):
            analyze(view(analytics()), ["remove-clickhouse"], max_steps=1)

    def test_obligation_prohibition_overlap_uses_existing_r17(self):
        records = analytics() + [event(10, "norm", {"modality": "F", "action": "serve-analytics", "scopes": ["analytics"]})]
        result = analyze(view(records), [])
        self.assertEqual(result["witnesses"], [{"kind": "obligation-prohibition", "premises": ["e5", "e1", "e10", "e7"], "action": "serve-analytics", "scopes": ["analytics"]}])

    def test_input_cannot_mint_accepted_commitment_atoms(self):
        with self.assertRaisesRegex(ValueError, "RESERVED_COMMITMENT_ATOM"):
            analyze(view(analytics(), as_of=6), ["commitment-active:e5"])
        for kind, data in [("evidence", {"atom": "commitment-active:e5"}),
                           ("rule", {"body": [], "head": "commitment-active:e5"})]:
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, "RESERVED_COMMITMENT_ATOM"):
                analyze(view([event(1, kind, data)]), [])

    def test_mutant_without_horn_propagation_misses_indirect_conflict(self):
        policy = {"facts": {"deployed"}, "horn": [(('deployed',), 'access'), (('access',), R17.BOT)], "deontic": [], "claims": [], "nvars": 0, "cons": []}
        self.assertTrue(R17.check(policy)["conflict"])
        self.assertFalse(R17.check(policy, propagate=False)["conflict"])

    def test_reference_interval_enumerator_does_not_claim_output_sensitive_cost(self):
        comparisons = []
        # All intervals overlap, but no pair clashes: zero output still costs nC2.
        result = R17._sweep_pairs([(i, 0, 1, "O") for i in range(32)],
                                  lambda a, b: comparisons.append((a, b)) or False)
        self.assertEqual(result, set())
        self.assertEqual(len(comparisons), 32 * 31 // 2)


if __name__ == "__main__":
    unittest.main()
