#!/usr/bin/env python3
"""Test daemon selection order and endpoint validation."""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class TestDaemonSelection(unittest.TestCase):
    def setUp(self):
        self.script_path = Path(__file__).parent / "../core/pd-console/scripts/console-ctl.py"
        assert self.script_path.exists(), f"Script not found: {self.script_path}"

    def test_env_var_takes_precedence(self):
        """Test PORT_DADDY_URL overrides file-based discovery."""
        with tempfile.TemporaryDirectory() as tmpdir:
            sock_path = os.path.join(tmpdir, "console.sock")
            env = os.environ.copy()
            env["PORT_DADDY_URL"] = "http://example.com:8080"
            env["PD_CONSOLE_CONTROL_SOCK"] = sock_path
            
            result = subprocess.run(
                [sys.executable, str(self.script_path), "ping"],
                env=env,
                capture_output=True,
                text=True
            )
            
            self.assertEqual(result.returncode, 2,
                             f"Expected exit 2, got {result.returncode}")
            self.assertIn("http://example.com:8080", result.stderr,
                         "Env var should be used for daemon selection")

    def test_file_discovery_order(self):
        """Test discovery order: env > console-daemon.url > daemon.port"""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create console-daemon.url
            url_file = os.path.join(tmpdir, ".port-daddy", "console-daemon.url")
            os.makedirs(os.path.dirname(url_file), exist_ok=True)
            with open(url_file, "w") as f:
                f.write("http://file-daemon:9090\n")
            
            # Create daemon.port
            port_file = os.path.join(tmpdir, ".port-daddy", "daemon.port")
            with open(port_file, "w") as f:
                f.write("8080\n")
            
            env = os.environ.copy()
            env["PD_CONSOLE_CONTROL_SOCK"] = os.path.join(tmpdir, "console.sock")
            
            # Test env var takes precedence
            env["PORT_DADDY_URL"] = "http://env-daemon:8081"
            result = subprocess.run(
                [sys.executable, str(self.script_path), "ping"],
                env=env,
                capture_output=True,
                text=True
            )
            self.assertIn("http://env-daemon:8081", result.stderr)
            
            # Test file discovery when env is missing
            del env["PORT_DADDY_URL"]
            result = subprocess.run(
                [sys.executable, str(self.script_path), "ping"],
                env=env,
                capture_output=True,
                text=True
            )
            self.assertIn("http://file-daemon:9090", result.stderr)
            
            # Test daemon.port fallback
            os.remove(url_file)
            result = subprocess.run(
                [sys.executable, str(self.script_path), "ping"],
                env=env,
                capture_output=True,
                text=True
            )
            self.assertIn("daemon.port: 8080", result.stderr)

    def test_no_fallback_on_missing_files(self):
        """Test no fallback when all discovery methods fail."""
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

    def test_state_verification(self):
        """Test state verification before capture."""
        with tempfile.TemporaryDirectory() as tmpdir:
            sock_path = os.path.join(tmpdir, "console.sock")
            env = os.environ.copy()
            env["PD_CONSOLE_CONTROL_SOCK"] = sock_path
            
            # Mock a broken state
            with open(os.path.join(tmpdir, "state.json"), "w") as f:
                f.write("{\"ok\": false, \"error\": \"test\"}")
            
            result = subprocess.run(
                [sys.executable, str(self.script_path), "state", "galaxy"],
                env=env,
                capture_output=True,
                text=True
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("State verification failed", result.stderr)

if __name__ == "__main__":
    unittest.main()