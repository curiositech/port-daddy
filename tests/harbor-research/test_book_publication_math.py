"""Run the Book's finite mathematical witnesses through CI discovery."""
import os
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
CHECKS = ROOT / "scripts" / "harbor-research"


class BookPublicationMathTests(unittest.TestCase):
    def run_witness(self, name):
        # The witness scripts use assertions: never inherit optimized Python.
        env = {**os.environ, "PYTHONOPTIMIZE": "0"}
        result = subprocess.run(
            [sys.executable, "-B", str(CHECKS / name)],
            cwd=ROOT, env=env, capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(
            result.returncode, 0,
            f"{name} failed ({result.returncode})\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )

    def test_foundations_witnesses(self):
        self.run_witness("check_book_foundations.py")

    def test_mechanism_witnesses(self):
        self.run_witness("check_book_mechanisms.py")

    def test_decision_witnesses(self):
        self.run_witness("check_book_decisions.py")


if __name__ == "__main__":
    unittest.main()
