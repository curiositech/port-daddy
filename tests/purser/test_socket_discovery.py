#!/usr/bin/env python3
"""Test socket discovery and error handling."""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class TestSocketDiscovery(unittest.TestCase):
    def setUp(self):
        self.script_path = Path(__file__).parent / "../core/pd-console/scripts/console-ctl.py"
        assert self.script_path.exists(), f"Script not found: {self.script_path}"

    def test_explicit_sock_flag(self):
        """Test --sock flag overrides env var and files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            sock1 = os.path.join(tmpdir, "sock1.sock")
            sock2 = os.path.join(tmpdir, "sock2.sock")
            env = os.environ.copy()
            env["PD_CONSOLE_CONTROL_SOCK"] = sock1
            
            result = subprocess.run(
                [sys.executable, str(self.script_path), "--sock", sock2, "ping"],
                env=env,
                capture_output=True,
                text=True
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn(sock2, result.stderr, "--sock path should be used")

    def test_tilde_expansion(self):
        """Test --sock path with ~ expands to home directory."""
        env = os.environ.copy()
        env.pop("PD_CONSOLE_CONTROL_SOCK", None)
        
        result = subprocess.run(
            [sys.executable, str(self.script_path), "--sock", "~/.port-daddy/test.sock", "ping"],
            env=env,
            capture_output=True,
            text=True
        )
        self.assertEqual(result.returncode, 2)
        self.assertNotIn("~", result.stderr, "Tilde should be expanded")

    def test_missing_sock_and_env(self):
        """Test error when --sock is missing and PD_CONSOLE_CONTROL_SOCK is not set."""
        env = os.environ.copy()
        env.pop("PD_CONSOLE_CONTROL_SOCK", None)
        
        result = subprocess.run(
            [sys.executable, str(self.script_path), "ping"],
            env=env,
            capture_output=True,
            text=True
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("PD_CONSOLE_CONTROL_SOCK not set", result.stderr)

    def test_fallback_prevention(self):
        """Test no fallback to hardcoded paths when all methods fail."""
        env = os.environ.copy()
        env.pop("PORT_DADDY_URL", None)
        env.pop("PD_CONSOLE_CONTROL_SOCK", None)
        
        result = subprocess.run(
            [sys.executable, str(self.script_path), "ping"],
            env=env,
            capture_output=True,
            text=True
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("PD_CONSOLE_CONTROL_SOCK not set", result.stderr)

if __name__ == "__main__":
    unittest.main()