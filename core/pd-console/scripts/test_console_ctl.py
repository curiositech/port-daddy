#!/usr/bin/env python3
"""Test coverage for console-ctl.py socket discovery and exit behavior."""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class TestConsoleCtlSocketDiscovery(unittest.TestCase):
    """Test console-ctl.py's socket discovery and explicit error handling."""

    def setUp(self):
        self.script_path = Path(__file__).parent / "console-ctl.py"
        assert self.script_path.exists(), f"Script not found: {self.script_path}"

    def test_exit_2_when_no_sock_and_no_env(self):
        """Exit code 2 when neither --sock nor PD_CONSOLE_CONTROL_SOCK is set."""
        env = os.environ.copy()
        env.pop("PD_CONSOLE_CONTROL_SOCK", None)

        result = subprocess.run(
            [sys.executable, str(self.script_path), "ping"],
            env=env,
            capture_output=True,
            text=True
        )

        self.assertEqual(result.returncode, 2,
                        f"Expected exit 2, got {result.returncode}. stderr: {result.stderr}")
        self.assertIn("PD_CONSOLE_CONTROL_SOCK", result.stderr,
                     "Error message should mention PD_CONSOLE_CONTROL_SOCK")

    def test_honors_env_var(self):
        """--sock picks honor the PD_CONSOLE_CONTROL_SOCK env var when set."""
        with tempfile.TemporaryDirectory() as tmpdir:
            sock_path = os.path.join(tmpdir, "console.sock")
            env = os.environ.copy()
            env["PD_CONSOLE_CONTROL_SOCK"] = sock_path

            # Command will fail to connect (no socket), but it should try
            # to connect to the sock_path from the env var, not fail early
            result = subprocess.run(
                [sys.executable, str(self.script_path), "ping"],
                env=env,
                capture_output=True,
                text=True
            )

            # Should exit 2 due to connection error, not missing socket discovery
            # The error message should indicate connection failure, not missing env var
            self.assertEqual(result.returncode, 2,
                           f"Expected exit 2, got {result.returncode}")
            # Should NOT complain about missing PD_CONSOLE_CONTROL_SOCK
            # (it should have found it in the env)
            self.assertNotIn(
                "not set",
                result.stdout + result.stderr,
                "Should not complain about env var not being set"
            )

    def test_explicit_sock_flag_takes_precedence(self):
        """--sock flag should take precedence over env var."""
        with tempfile.TemporaryDirectory() as tmpdir:
            sock1 = os.path.join(tmpdir, "console1.sock")
            sock2 = os.path.join(tmpdir, "console2.sock")
            env = os.environ.copy()
            env["PD_CONSOLE_CONTROL_SOCK"] = sock1

            result = subprocess.run(
                [sys.executable, str(self.script_path), "--sock", sock2, "ping"],
                env=env,
                capture_output=True,
                text=True
            )

            # Should fail to connect to sock2, not sock1
            # The error message should mention sock2
            self.assertEqual(result.returncode, 2)
            self.assertIn(sock2, result.stdout,
                         "Error should mention the --sock path, not env var")

    def test_explicit_sock_with_tilde_expansion(self):
        """--sock flag should expand ~ to home directory."""
        env = os.environ.copy()
        env.pop("PD_CONSOLE_CONTROL_SOCK", None)

        result = subprocess.run(
            [sys.executable, str(self.script_path), "--sock", "~/.port-daddy/test.sock", "ping"],
            env=env,
            capture_output=True,
            text=True
        )

        # Should fail to connect (socket doesn't exist), not fail parsing tilde
        self.assertEqual(result.returncode, 2)
        # The error message should show the expanded path or connection error,
        # not a parse error about tilde
        self.assertNotIn("~", result.stderr,
                        "Tilde should be expanded, not appear in error")


if __name__ == "__main__":
    unittest.main()
