"""The evidence gate must reject absent witnesses even after assertion success."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "check_kani_log", Path(__file__).with_name("check-kani-log.py"))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


def successful_log():
    blocks = []
    for name, count in checker.EXPECTED.items():
        coverage = f" ** {count} of {count} cover properties satisfied\n" if count else ""
        blocks.append(f"Checking harness kani_claims::{name}...\n"
                      f"{coverage}VERIFICATION:- SUCCESSFUL\n")
    return "".join(blocks) + "Complete - 5 successfully verified harnesses, 0 failures, 5 total.\n"


class EvidenceGate(unittest.TestCase):
    def test_complete_success(self):
        checker.check(successful_log())

    def test_unsatisfied_acceptance_cover_is_not_success(self):
        text = successful_log().replace("7 of 7 cover", "6 of 7 cover")
        with self.assertRaisesRegex(ValueError, "unsatisfied cover"):
            checker.check(text)

    def test_absent_cover_output_is_not_success(self):
        text = successful_log().replace(" ** 7 of 7 cover properties satisfied\n", "")
        with self.assertRaisesRegex(ValueError, "missing or unsatisfied"):
            checker.check(text)

    def test_missing_harness_is_not_success(self):
        text = successful_log().replace("proof_decoded_claims_policy", "unregistered_proof")
        with self.assertRaisesRegex(ValueError, "missing harnesses"):
            checker.check(text)

    def test_failed_assertion_is_not_success(self):
        text = successful_log().replace("VERIFICATION:- SUCCESSFUL", "VERIFICATION:- FAILED", 1)
        with self.assertRaisesRegex(ValueError, "did not verify"):
            checker.check(text)

    def test_duplicate_harness_is_not_success(self):
        with self.assertRaisesRegex(ValueError, "duplicate harness"):
            checker.check(successful_log() + successful_log())

    def test_absent_summary_is_not_success(self):
        text = successful_log().replace("0 failures, 5 total", "1 failures, 6 total")
        with self.assertRaisesRegex(ValueError, "exact five-harness"):
            checker.check(text)


if __name__ == "__main__":
    unittest.main()
