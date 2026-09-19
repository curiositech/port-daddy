#!/usr/bin/env python3
"""Unit tests for the stdlib-only Porthole control driver."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import socket
import tempfile
import threading
import unittest


PACKAGE = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location(
    "porthole_control", PACKAGE / "Scripts/porthole-control.py"
)
control = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(control)


class PortholeControlDriverTests(unittest.TestCase):
    def test_scenario_adds_ids_and_rejects_nested_or_oversized_batches(self):
        with tempfile.TemporaryDirectory(prefix="porthole-driver-") as root:
            scenario = Path(root) / "scenario.json"
            scenario.write_text(json.dumps([{"command": "ping"}, {"command": "status"}]))
            steps = control.load_scenario(str(scenario))
            self.assertEqual([step["command"] for step in steps], ["ping", "status"])
            self.assertTrue(all(step["id"].startswith("step-") for step in steps))

            scenario.write_text(json.dumps([{"command": "batch", "steps": []}]))
            with self.assertRaisesRegex(ValueError, "non-batch"):
                control.load_scenario(str(scenario))

            scenario.write_text(json.dumps([{"command": "ping"}] * 65))
            with self.assertRaisesRegex(ValueError, "1-64"):
                control.load_scenario(str(scenario))

    def test_driver_round_trip_preserves_structured_receipt(self):
        with tempfile.TemporaryDirectory(prefix="porthole-driver-") as root:
            socket_path = str(Path(root) / "control.sock")
            ready = threading.Event()

            def serve():
                listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                listener.bind(socket_path)
                listener.listen(1)
                ready.set()
                client, _ = listener.accept()
                with client:
                    request = json.loads(client.recv(4096).split(b"\n", 1)[0])
                    response = {
                        "schema": "pd.porthole.local-control-response.v1",
                        "id": request["id"],
                        "command": request["command"],
                        "ok": True,
                        "result": {"message": "pong"},
                    }
                    client.sendall(json.dumps(response).encode() + b"\n")
                listener.close()

            thread = threading.Thread(target=serve, daemon=True)
            thread.start()
            self.assertTrue(ready.wait(1))
            receipt = control.send_request(
                socket_path, {"id": "driver-test", "command": "ping"}, 2
            )
            thread.join(1)
            self.assertTrue(receipt["ok"])
            self.assertEqual(receipt["result"]["message"], "pong")

    def test_request_and_response_bounds_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "32768"):
            control.send_request("/does/not/exist", {"id": "x", "command": "ping", "pad": "x" * 40_000}, 1)


if __name__ == "__main__":
    unittest.main()
