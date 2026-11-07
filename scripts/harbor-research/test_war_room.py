#!/usr/bin/env python3
"""Zero-secret host fixture tests. Temporary files remain under ~/coding/tmp."""
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

import war_room as room


class WarRoomTests(unittest.TestCase):
    def setUp(self):
        # The test scratch directory is owned and cleaned by this fixture only.
        self.scratch = tempfile.TemporaryDirectory(prefix='war-room-test-', dir=room.BASE)
        self.root = Path(self.scratch.name)
        self.campaign = self.root / 'campaign'
        self.input = self.root / 'model.json'
        self.input.write_text('{"fixture":true}\n')
        room.record_event(self.campaign, 'root', 'open', {'scope': 'synthetic fixture only'})
        room.freeze(self.campaign, [self.input])

    def tearDown(self):
        self.scratch.cleanup()

    def run_command(self, code, **kwargs):
        return room.run(self.campaign, 'blue', self.root, [sys.executable, '-c', code], reviewed=True, **kwargs)

    def test_run_capture_seal_and_external_anchor(self):
        result = self.run_command("import sys; print('visible out'); print('visible err',file=sys.stderr)")
        self.assertEqual(result['exit_code'], 0)
        self.assertFalse(result['timed_out'])
        self.assertFalse(result['group_cleanup_forced'])
        self.assertTrue(result['group_quiescent'])
        self.assertEqual((self.campaign / result['artifacts'][0]['name']).read_text(), 'visible out\n')
        self.assertEqual((self.campaign / result['artifacts'][1]['name']).read_text(), 'visible err\n')
        sealed = room.seal(self.campaign)
        self.assertEqual(room.verify(self.campaign, sealed['seal_sha256'])['events'], 4)
        with self.assertRaises(ValueError):
            room.verify(self.campaign, '0' * 64)
        with self.assertRaises(ValueError):
            room.record_event(self.campaign, 'red', 'finding', {'summary': 'late'})

    def test_changed_seal_and_untracked_artifacts_fail_closed(self):
        sealed = room.seal(self.campaign)
        path = self.campaign / 'seal.json'
        original = path.read_bytes()
        document = json.loads(original)
        document['privacy_enforced'] = True
        path.write_text(json.dumps(document))
        with self.assertRaises(ValueError):
            room.verify(self.campaign, sealed['seal_sha256'])
        path.write_bytes(original)
        (self.campaign / 'untracked.txt').write_text('uncommitted')
        with self.assertRaises(ValueError):
            room.verify(self.campaign)

    def test_timeout_is_logged_not_a_success_claim(self):
        result = self.run_command("import time; print('started',flush=True); time.sleep(20)", timeout=0.1)
        self.assertTrue(result['timed_out'])
        self.assertEqual(result['status'], 'timeout')
        self.assertTrue(result['group_cleanup_forced'])
        self.assertTrue(result['group_quiescent'])
        self.assertEqual(result['group_cleanup_reason'], 'execution-deadline')
        self.assertNotEqual(result['exit_code'], 0)
        self.assertEqual(room.verify(self.campaign)['incomplete_runs'], [])
        self.assertTrue(room.seal(self.campaign)['sealed'])  # Evidence sealing is not a PASS.

    def test_parent_exit_cannot_leave_a_writer_after_run_or_seal(self):
        # Reviewed fixture: the direct parent exits after its child is ready.
        # The child retains both captured descriptors and tries a delayed write.
        child = ("from pathlib import Path; import sys,time; "
                 "print('child-ready',flush=True); Path('child-ready').touch(); "
                 "exec(\"while not Path('after-return').exists(): time.sleep(0.001)\"); "
                 "Path('late-marker').write_text('late'); "
                 "print('late-out',flush=True); print('late-err',file=sys.stderr,flush=True)")
        parent = ("from pathlib import Path; import subprocess,sys,time; "
                  f"subprocess.Popen([sys.executable,'-c',{child!r}]); "
                  "exec(\"while not Path('child-ready').exists(): time.sleep(0.001)\"); "
                  "print('parent-exit',flush=True)")
        result = self.run_command(parent, timeout=1)
        before = [(self.campaign / a['name']).read_bytes() for a in result['artifacts']]
        sealed = room.seal(self.campaign)
        (self.root / 'after-return').touch()
        time.sleep(0.2)  # An extant child may write only after run() and seal().
        self.assertFalse((self.root / 'late-marker').exists(), 'same-group child survived run()')
        self.assertEqual(before, [(self.campaign / a['name']).read_bytes() for a in result['artifacts']])
        self.assertTrue(room.verify(self.campaign, sealed['seal_sha256'])['sealed'])
        self.assertEqual(result['exit_code'], 0)
        self.assertFalse(result['timed_out'])
        self.assertTrue(result['group_cleanup_forced'])
        self.assertTrue(result['group_quiescent'])
        self.assertEqual(result['status'], 'descendants-terminated')
        self.assertLess(result['group_cleanup_seconds'], room.GROUP_CLEANUP_TIMEOUT)

    def test_direct_failure_is_preserved_when_descendants_are_terminated(self):
        child = "from pathlib import Path; import time; Path('ready').touch(); time.sleep(20)"
        parent = ("from pathlib import Path; import subprocess,sys,time; "
                  f"subprocess.Popen([sys.executable,'-c',{child!r}]); "
                  "exec(\"while not Path('ready').exists(): time.sleep(0.001)\"); sys.exit(7)")
        result = self.run_command(parent, timeout=1)
        self.assertEqual(result['exit_code'], 7)
        self.assertFalse(result['timed_out'])
        self.assertTrue(result['group_cleanup_forced'])
        self.assertTrue(result['group_quiescent'])
        self.assertEqual(result['group_cleanup_reason'], 'live-descendants-after-direct-exit')

    def test_observation_failure_cannot_bind_outputs_or_seal(self):
        with patch.object(room, '_live_group_members', side_effect=ValueError('synthetic observation failure')):
            with self.assertRaisesRegex(ValueError, 'synthetic observation failure'):
                self.run_command("print('unverified output')", timeout=1)
        events = [json.loads(line) for line in (self.campaign / 'blue.jsonl').read_text().splitlines()]
        self.assertEqual([event['kind'] for event in events], ['run-start'])
        self.assertNotIn('artifacts', events[0]['data'])
        with self.assertRaises(ValueError):
            room.seal(self.campaign)

    def test_lost_child_ownership_never_signals_reused_group(self):
        process = Mock(pid=12345, returncode=None)
        with patch.object(room, '_observe_exit', side_effect=ChildProcessError('already reaped')):
            with patch.object(room.os, 'killpg') as kill:
                with self.assertRaises(ChildProcessError):
                    room._finish_process_group(process, time.monotonic(), 1)
                kill.assert_not_called()

    def test_cli_reports_forced_cleanup_even_with_direct_exit_zero(self):
        result = {'exit_code': 0, 'timed_out': False, 'launch_error': None,
                  'group_cleanup_forced': True, 'status': 'descendants-terminated'}
        with patch.object(room, 'run', return_value=result), redirect_stdout(io.StringIO()):
            code = room.main(['--campaign', str(self.campaign), 'run', '--team', 'blue',
                              '--cwd', str(self.root), '--reviewed', '--', sys.executable, '-c', 'pass'])
        self.assertEqual(code, 1)

    def test_group_observation_requires_anchor_and_ignores_only_exited_members(self):
        observation = Mock(returncode=0, stderr='', stdout='100 100 Z\n101 100 S\n102 100 Z\n200 200 S\n')
        with patch.object(room.subprocess, 'run', return_value=observation):
            self.assertEqual(room._live_group_members(100, 1), [101])
        for output in ['', '200 200 S\n']:
            observation.stdout = output
            with patch.object(room.subprocess, 'run', return_value=observation):
                with self.assertRaisesRegex(ValueError, 'leader absent'):
                    room._live_group_members(100, 1)

    def test_log_mutation_and_truncation_fail_closed(self):
        path = self.campaign / 'root.jsonl'
        original = path.read_bytes()
        for bad in [original.replace(b'synthetic', b'fictional'), b'', b' ' + original]:
            path.write_bytes(bad)
            with self.assertRaises(ValueError):
                room.verify(self.campaign)
            with self.assertRaises(ValueError):
                room.record_event(self.campaign, 'blue', 'repair', {})
            path.write_bytes(original)

    def test_missing_log_and_changed_input_fail_closed(self):
        path = self.campaign / 'red.jsonl'
        path.unlink()
        with self.assertRaises(FileNotFoundError):
            room.verify(self.campaign)
        path.touch()
        self.input.write_text('changed')
        with self.assertRaises(ValueError):
            self.run_command("print('must not run')")
        self.assertEqual((self.campaign / 'blue.jsonl').read_bytes(), b'')

    def test_output_tampering_and_missing_file(self):
        result = self.run_command("print('artifact')")
        path = self.campaign / result['artifacts'][0]['name']
        path.write_text('altered')
        with self.assertRaises(ValueError):
            room.seal(self.campaign)
        path.unlink()
        with self.assertRaises(FileNotFoundError):
            room.verify(self.campaign)

    def test_reject_bad_paths_symlink_and_unreviewed_command(self):
        for path in ['/private/tmp/war-room', str(self.root / '..' / 'escape'), str(room.BASE)]:
            with self.subTest(path=path), self.assertRaises(ValueError):
                room.guarded(path)
        alias = self.root / 'alias'
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            room.verify(alias / 'campaign')
        with self.assertRaises(ValueError):
            room.run(self.campaign, 'blue', self.root, [sys.executable, '-c', 'print(1)'])
        with self.assertRaises(ValueError):
            room.run(self.campaign, 'blue', self.root, ['python3', '-c', 'print(1)'], reviewed=True)
        with self.assertRaises(ValueError):
            room.run(self.campaign, 'blue', '/private/tmp', [sys.executable, '-c', 'print(1)'], reviewed=True)

    def test_no_shell_interpolation_and_no_ambient_secret_env(self):
        original = os.environ.get('WAR_ROOM_TEST_SYNTHETIC_SECRET')
        os.environ['WAR_ROOM_TEST_SYNTHETIC_SECRET'] = 'fixture-marker'
        try:
            result = self.run_command("import os; print(os.environ.get('WAR_ROOM_TEST_SYNTHETIC_SECRET','absent')); print('$(not-a-command)')")
            output = (self.campaign / result['artifacts'][0]['name']).read_text()
            self.assertEqual(output, 'absent\n$(not-a-command)\n')
        finally:
            if original is None:
                del os.environ['WAR_ROOM_TEST_SYNTHETIC_SECRET']
            else:
                os.environ['WAR_ROOM_TEST_SYNTHETIC_SECRET'] = original

    def test_host_mode_is_not_cross_team_privacy(self):
        # This harmless disclosure proves the limitation instead of asserting
        # that separate directories enforce a denial they do not enforce.
        marker = self.root / 'other-team-marker.txt'
        marker.write_text('synthetic-shared-marker')
        result = self.run_command(f"from pathlib import Path; print(Path({str(marker)!r}).read_text())")
        self.assertEqual(result['mode'], 'host-reviewed-process')
        self.assertIn('synthetic-shared-marker', (self.campaign / result['artifacts'][0]['name']).read_text())
        frozen = room.read_json(self.campaign / 'freeze.json')
        self.assertFalse(frozen['privacy_enforced'])
        self.assertIsNone(frozen['signature'])

    def test_incomplete_start_cannot_run_or_seal(self):
        with room.locked(self.campaign) as directory:
            room.append(directory, 'blue', 'run-start', {'run_id': 'interrupted'})
        self.assertEqual(room.verify(self.campaign)['incomplete_runs'], ['interrupted'])
        with self.assertRaises(ValueError):
            room.seal(self.campaign)
        with self.assertRaises(ValueError):
            self.run_command('print(1)')

    def test_cli_rejects_missing_evidence(self):
        script = Path(__file__).with_name('war_room.py')
        process = subprocess.run([sys.executable, '-B', str(script), '--campaign', str(self.root / 'missing'), 'verify'],
                                 cwd=self.root, capture_output=True, text=True, check=False)
        self.assertEqual(process.returncode, 2)
        self.assertEqual(json.loads(process.stdout)['status'], 'invalid')


if __name__ == '__main__':
    unittest.main(verbosity=2)
