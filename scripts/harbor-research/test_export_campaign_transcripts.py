import gzip
import importlib.util
import json
import os
import stat
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("exporter", Path(__file__).with_name("export_campaign_transcripts.py"))
exporter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(exporter)


def event(kind="message", **payload):
    return {"timestamp": "2026-11-06T20:00:00Z", "type": "response_item", "payload": {"type": kind, **payload}}


def message(text, role="assistant", phase="commentary"):
    return event(role=role, phase=phase, content=[{"type": "output_text", "text": text}])


class ExportTests(unittest.TestCase):
    def test_visible_values_preserved_without_internal_metadata(self):
        row = message("Line 1\nUnicode: λ; literal \\n")
        row["payload"]["internal_chat_message_metadata_passthrough"] = {"creator_account": "private"}
        row["payload"]["encrypted_content"] = "hidden"
        actual, reason, dropped = exporter.project(row)
        self.assertFalse(reason)
        self.assertEqual(actual["payload"]["content"], row["payload"]["content"])
        self.assertNotIn("private", json.dumps(actual))
        self.assertEqual(len(dropped), 2)

    def test_hidden_roles_phases_and_records_are_excluded(self):
        rows = [message("hidden", role="system"), message("hidden", role="developer"),
                message("hidden", phase="analysis"), message("hidden", phase=None),
                event("reasoning", summary="hidden"), {"type": "turn_context", "payload": {"text": "hidden"}},
                {"type": "session_meta", "payload": {"base_instructions": "hidden"}}]
        for row in rows:
            with self.subTest(row=row):
                self.assertIsNone(exporter.project(row)[0])

    def test_tool_arguments_stdout_and_agent_messages_are_preserved(self):
        rows = [event("function_call", name="exec_command", call_id="c1", arguments='{"cmd":"printf abc"}'),
                event("function_call_output", call_id="c1", output="stdout\nexit_code=0"),
                event("custom_tool_call", name="exec", call_id="c2", input="text(42);"),
                event("custom_tool_call_output", call_id="c2", output="42"),
                event("agent_message", author="/root/worker", recipient="/root", content=[{"type": "text", "text": "Review complete."}])]
        for row in rows:
            self.assertEqual(exporter.project(row)[0], row)

    def test_credentials_omit_whole_event(self):
        for text in ["Bearer abcdefghijklmnop", "pdr_abcdefghijklmnop", "ghp_abcdefghijklmnop", "sk-proj-abcdefghijklmnop", '"access_token":"abcdefgh123456"', "pairing code = ABCDEF12", "pairing code is ABCDEF12", '"token":"abcdefghijklmnop"', "AKIAABCDEFGHIJKLMNOP", "-----BEGIN PRIVATE KEY-----"]:
            with self.subTest(text=text):
                self.assertEqual(exporter.project(message(text))[1], "credential_pattern")

    def test_nested_prompt_and_source_inspection_are_excluded(self):
        for text in ['{"base_instructions":"private"}', '{"role":"system","content":"private"}', '{"type":"reasoning"}', "internal_chat_message_metadata_passthrough", '{"creator_account_id":"private"}']:
            self.assertEqual(exporter.project(event("function_call_output", output=text))[1], "protected_prompt_or_internal_state")
        self.assertEqual(exporter.project(event("custom_tool_call", input="read .codex/sessions"))[1], "transcript_inspection_or_export_preparation")

    def test_unknown_content_fails_closed(self):
        self.assertIsNone(exporter.project(event(content=[{"type": "reasoning", "text": "private"}], role="user"))[0])
        self.assertIsNone(exporter.project(event("future_unknown", output="private"))[0])

    def test_source_offsets_cutoff_pairing_and_complete_prefix(self):
        rows = [message("old"), event("function_call", call_id="bad", arguments="safe command"), event("function_call_output", call_id="bad", output="Bearer abcdefghijklmnop"), message("kept")]
        rows[0]["timestamp"] = "2026-11-06T18:00:00Z"
        raw = b"".join(exporter.encode(row) for row in rows)
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            path = Path(directory) / "source.jsonl"
            path.write_bytes(raw + b'{"partial"')
            actual, omissions, manifest = exporter.export_source({"path": path, "id": "root", "parent_id": None}, "2026-11-06T19:00:00Z")
            self.assertEqual(len(actual), 1)
            self.assertEqual(actual[0]["source_line"], 4)
            self.assertEqual(actual[0]["source_byte_offset"], len(raw) - len(exporter.encode(rows[3])))
            self.assertEqual(manifest["source_prefix_sha256"], exporter.digest(raw))
            self.assertEqual(manifest["incomplete_trailing_bytes_not_exported"], 10)
            self.assertEqual({row["reason"] for row in omissions}, {"before_root_cutoff", "credential_pattern", "paired_with_excluded_tool_event"})
            self.assertEqual(path.read_bytes(), raw + b'{"partial"')

    def test_discovery_reads_unrelated_first_line_only(self):
        def meta(sid, parent=None, born="2026-11-06T19:00:00Z"):
            return {"type": "session_meta", "timestamp": born, "payload": {"id": sid, "timestamp": born, "source": {"subagent": {"thread_spawn": {"parent_thread_id": parent}}}}}
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            directory = Path(directory)
            for name, row in [("root", meta("root", born="2026-09-26T19:00:00Z")), ("child", meta("child", "root", "2026-11-07T03:00:00Z")), ("grandchild", meta("grandchild", "child")), ("other", meta("other", "unrelated")), ("old", meta("old", "root", "2026-11-05T19:00:00Z"))]:
                (directory / (name + ".jsonl")).write_bytes(exporter.encode(row) + b'UNAUTHORIZED BODY MUST NOT BE PARSED\n')
            sources = exporter.discover(directory / "root.jsonl", "root", directory, "2026-11-06")
            self.assertEqual({row["id"] for row in sources}, {"root", "child", "grandchild"})
            with self.assertRaisesRegex(ValueError, "identity mismatch"):
                exporter.discover(directory / "root.jsonl", "wrong", directory, "2026-11-06")

    def test_archive_roundtrip_and_reproducibility(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            path = Path(directory) / "events.jsonl.gz"
            rows = [{"visible": "λ\nvalue"}]
            one = exporter.archive(path, rows)
            two = exporter.archive(path, rows)
            self.assertEqual(one, two)
            self.assertEqual(json.loads(gzip.decompress(path.read_bytes())), rows[0])


    def test_structured_and_reencoded_tool_content_is_excluded(self):
        private = [
            {"role": "system", "content": "SYNTHETIC_PRIVATE_PROMPT"},
            {"role": "DEVELOPER", "content": "SYNTHETIC_PRIVATE_PROMPT"},
            {"type": "reasoning", "text": "SYNTHETIC_PRIVATE_REASONING"},
            {"channel": "analysis", "text": "SYNTHETIC_PRIVATE_REASONING"},
            {"internal_chat_message_metadata_passthrough": {"account": "synthetic"}},
            {"base_instructions": "synthetic"},
            {"encrypted_content": "synthetic"},
            {"reasoning": {"summary": "SYNTHETIC_PRIVATE_REASONING"}},
            {"system_prompt": "SYNTHETIC_PRIVATE_PROMPT"},
            {"creator_account": "synthetic"},
            {"access_token": "SYNTHETIC_CREDENTIAL_12345"},
        ]
        for item in private:
            for output in (item, {"result": [item]}, json.dumps(item),
                           json.dumps(json.dumps(item)), {"result": json.dumps(item)}):
                with self.subTest(item=item, output=output):
                    projected, reason, _ = exporter.project(event("function_call_output", output=output))
                    self.assertIsNone(projected)
                    self.assertIn(reason, {"protected_prompt_or_internal_state", "credential_pattern"})
        safe = {"values": [1, 2], "text": "Reviewed synthetic result"}
        self.assertEqual(exporter.project(event("function_call_output", output=safe))[0]["payload"]["output"], safe)

    def test_structural_omission_excludes_both_exchange_directions(self):
        rows = [event("function_call", call_id="private", arguments="safe command"),
                event("function_call_output", call_id="private", output={"type": "reasoning", "text": "synthetic"}),
                message("kept")]
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            source = Path(directory) / "source.jsonl"
            source.write_bytes(b"".join(exporter.encode(row) for row in rows))
            kept, omitted, _ = exporter.export_source({"path": source, "id": "root", "parent_id": None}, None)
            self.assertEqual(len(kept), 1)
            self.assertEqual({row["reason"] for row in omitted},
                             {"protected_prompt_or_internal_state", "paired_with_excluded_tool_event"})

    def test_nested_depth_limit_fails_closed(self):
        item = {"safe": "synthetic"}
        for _ in range(70):
            item = {"next": item}
        self.assertEqual(exporter.project(event("function_call_output", output=item))[1], "unsupported_nested_content")

    def test_private_archive_is_0600_before_write_under_permissive_umask(self):
        real_fdopen = os.fdopen
        seen = []
        class CheckedWriter:
            def __init__(self, descriptor, mode):
                self.stream = real_fdopen(descriptor, mode)
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return self.stream.__exit__(*args)
            def fileno(self):
                return self.stream.fileno()
            def flush(self):
                return self.stream.flush()
            def write(self, data):
                seen.append(stat.S_IMODE(os.fstat(self.fileno()).st_mode))
                return self.stream.write(data)
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            path = Path(directory) / "private.jsonl.gz"
            old = os.umask(0)
            try:
                with patch.object(exporter.os, "fdopen", side_effect=CheckedWriter):
                    exporter.archive(path, [{"visible": "synthetic"}])
            finally:
                os.umask(old)
            self.assertEqual(seen, [0o600])
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_new_descendant_and_manifest_are_private_on_refresh(self):
        def meta(sid, parent=None):
            return {"type": "session_meta", "timestamp": "2026-11-06T19:00:00Z",
                    "payload": {"id": sid, "timestamp": "2026-11-06T19:00:00Z",
                                "source": {"subagent": {"thread_spawn": {"parent_thread_id": parent}}}}}
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            directory = Path(directory)
            root = directory / "root.jsonl"
            root.write_bytes(exporter.encode(meta("root")) + exporter.encode(message("root synthetic")))
            output = directory / "projection"
            old = os.umask(0)
            try:
                exporter.run(root, "root", directory, "2026-11-06", "2026-11-06T19:00:00Z", output)
                (directory / "child.jsonl").write_bytes(exporter.encode(meta("child", "root")) + exporter.encode(message("child synthetic")))
                refreshed = exporter.run(root, "root", directory, "2026-11-06", "2026-11-06T19:00:00Z", output)
            finally:
                os.umask(old)
            self.assertEqual(refreshed["sessions"], 2)
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o700)
            self.assertEqual({stat.S_IMODE(path.stat().st_mode) for path in output.iterdir()}, {0o600})
            self.assertTrue((output / "child.visible.jsonl.gz").is_file())

    def test_archive_refuses_symlink_directory_file_and_hardlink(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            directory = Path(directory)
            real = directory / "real"
            real.mkdir()
            alias = directory / "alias"
            alias.symlink_to(real, target_is_directory=True)
            with self.assertRaises(OSError):
                exporter.archive(alias / "events.gz", [])
            target = real / "original"
            target.write_bytes(b"unchanged")
            link = real / "events.gz"
            link.symlink_to(target)
            with self.assertRaises(ValueError):
                exporter.archive(link, [])
            link.unlink()
            os.link(target, link)
            with self.assertRaises(ValueError):
                exporter.archive(link, [])
            self.assertEqual(target.read_bytes(), b"unchanged")
            self.assertEqual(list(real.glob("*.pending")), [])

    def test_failed_atomic_replace_preserves_prior_archive(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            path = Path(directory) / "private.gz"
            exporter.archive(path, [{"original": True}])
            original = path.read_bytes()
            with patch.object(exporter.os, "replace", side_effect=OSError("synthetic failure")):
                with self.assertRaises(OSError):
                    exporter.archive(path, [{"replacement": True}])
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(list(path.parent.glob("*.pending")), [])


if __name__ == "__main__":
    unittest.main()
