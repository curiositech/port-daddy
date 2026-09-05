import importlib.util
import pathlib
import unittest
from unittest import mock


SCRIPT = pathlib.Path(__file__).parents[1] / "console-ctl.py"
SPEC = importlib.util.spec_from_file_location("console_ctl", SCRIPT)
console_ctl = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(console_ctl)


class ConsoleCtlScenarioTests(unittest.TestCase):
    def test_type_step_preserves_text_and_does_not_invent_send(self):
        scenario = {
            "schema": console_ctl.SCENARIO_SCHEMA,
            "protocolVersion": console_ctl.PROTOCOL_VERSION,
            "steps": [{"cmd": "type", "target": "mission.composer", "text": "inspect claims"}],
        }
        reply = {"ok": True, "result": {"sent": False, "value": "inspect claims"}}
        with mock.patch.object(console_ctl, "send", return_value=reply) as send:
            output = console_ctl.run_scenario("/unused.sock", scenario)
        self.assertTrue(output["ok"])
        self.assertFalse(output["steps"][0]["result"]["result"]["sent"])
        expected = dict(scenario["steps"][0], protocolVersion=console_ctl.PROTOCOL_VERSION)
        send.assert_called_once_with("/unused.sock", expected)

    def test_abort_and_continue_are_explicit(self):
        steps = [{"cmd": "click", "target": "missing"}, {"cmd": "describe"}]
        failed = {"ok": False, "error": {"code": "unknown_selector"}}
        passed = {"ok": True, "result": {}}
        with mock.patch.object(console_ctl, "send", side_effect=[failed, passed]):
            aborted = console_ctl.run_scenario(
                "/unused.sock",
                {
                    "schema": console_ctl.SCENARIO_SCHEMA,
                    "protocolVersion": console_ctl.PROTOCOL_VERSION,
                    "steps": steps,
                },
            )
        self.assertTrue(aborted["aborted"])
        self.assertEqual(len(aborted["steps"]), 1)

        with mock.patch.object(console_ctl, "send", side_effect=[failed, passed]):
            continued = console_ctl.run_scenario(
                "/unused.sock",
                {
                    "schema": console_ctl.SCENARIO_SCHEMA,
                    "protocolVersion": console_ctl.PROTOCOL_VERSION,
                    "onError": "continue",
                    "steps": steps,
                },
            )
        self.assertFalse(continued["aborted"])
        self.assertEqual(len(continued["steps"]), 2)
        self.assertFalse(continued["ok"])

    def test_wait_timeout_is_bounded(self):
        clock = mock.Mock(side_effect=[0.0, 0.0, 0.02])
        failed = {"ok": False, "error": {"code": "assertion_failed"}}
        with mock.patch.object(console_ctl, "send", return_value=failed), mock.patch.object(
            console_ctl.time, "monotonic", clock
        ), mock.patch.object(console_ctl.time, "sleep"):
            output = console_ctl.wait_for(
                "/unused.sock",
                {"cmd": "wait", "path": "launcher.open", "value": True, "timeoutMs": 10},
            )
        self.assertFalse(output["ok"])
        self.assertEqual(output["error"]["code"], "wait_timeout")

    def test_receipt_ignores_timestamps_but_not_results(self):
        first = [{"timestamp": "one", "durationMs": 4, "request": {"cmd": "describe"}, "result": {"ok": True}}]
        second = [{"timestamp": "two", "durationMs": 90, "request": {"cmd": "describe"}, "result": {"ok": True}}]
        changed = [{"timestamp": "two", "request": {"cmd": "describe"}, "result": {"ok": False}}]
        self.assertEqual(console_ctl.replay_receipt(first), console_ctl.replay_receipt(second))
        self.assertNotEqual(console_ctl.replay_receipt(first), console_ctl.replay_receipt(changed))

    def test_scenario_and_wait_bounds(self):
        with self.assertRaisesRegex(ValueError, "1..64"):
            console_ctl.run_scenario(
                "/unused.sock",
                {
                    "schema": console_ctl.SCENARIO_SCHEMA,
                    "protocolVersion": console_ctl.PROTOCOL_VERSION,
                    "steps": [],
                },
            )
        with self.assertRaisesRegex(ValueError, "timeoutMs"):
            console_ctl.wait_for(
                "/unused.sock",
                {"cmd": "wait", "path": "launcher.open", "value": True, "timeoutMs": 30_001},
            )

    def test_scenario_rejects_unknown_fields_and_wrong_protocol(self):
        with self.assertRaisesRegex(ValueError, "unknown scenario fields"):
            console_ctl.run_scenario(
                "/unused.sock",
                {
                    "schema": console_ctl.SCENARIO_SCHEMA,
                    "protocolVersion": console_ctl.PROTOCOL_VERSION,
                    "steps": [{"cmd": "describe"}],
                    "extra": True,
                },
            )
        with self.assertRaisesRegex(ValueError, "protocolVersion"):
            console_ctl.run_scenario(
                "/unused.sock",
                {
                    "schema": console_ctl.SCENARIO_SCHEMA,
                    "protocolVersion": 999,
                    "steps": [{"cmd": "describe"}],
                },
            )

    def test_wait_rejects_unknown_fields(self):
        with self.assertRaisesRegex(ValueError, "unknown wait fields"):
            console_ctl.wait_for(
                "/unused.sock",
                {"cmd": "wait", "path": "terminal.open", "value": True, "surprise": True},
            )


if __name__ == "__main__":
    unittest.main()
