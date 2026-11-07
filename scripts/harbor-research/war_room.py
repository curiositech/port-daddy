#!/usr/bin/env python3
"""Offline visible evidence ledger; host-reviewed processes, NOT a sandbox.

Hash chains detect inconsistent bytes; an externally retained seal digest anchors
an archive. Same-UID rewriting, secrecy, network isolation, descendants that leave
the process group, and hard resource quotas are outside this tool's guarantees.
Same-group writers must exit before output hashing. Cleanup has a recorded
two-second grace; failed quiescence observation leaves the run incomplete.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time
import uuid

BASE = (Path.home() / 'coding/tmp').resolve()
TEAMS = ('red', 'white', 'blue', 'root')
MODE = 'host-reviewed-process'
ZERO = '0' * 64
GROUP_CLEANUP_TIMEOUT = 2.0
GROUP_PROBE = ['/bin/ps', '-axo', 'pid=,pgid=,stat=']


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def guarded(path):
    candidate = Path(path).absolute()
    try:
        relative = candidate.relative_to(BASE)
    except ValueError as error:
        raise ValueError('Path must be under ~/coding/tmp') from error
    if '..' in relative.parts or candidate == BASE:
        raise ValueError('Traversal or base-directory target refused')
    cursor = BASE
    for part in relative.parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ValueError('Symlink path refused')
    return candidate


def read_file(path):
    path = guarded(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise ValueError('Expected regular, single-link evidence file')
    return path.read_bytes()


def read_json(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate JSON field')
            result[key] = value
        return result
    return json.loads(read_file(path), object_pairs_hook=unique)


def write_json(path, value):
    path = guarded(path)
    pending = path.with_name(path.name + '.pending')
    with pending.open('xb') as output:
        output.write(canonical(value) + b'\n')
        output.flush()
        os.fsync(output.fileno())
    os.replace(pending, path)


def inventory(path):
    data = read_file(path)
    return {'path': str(guarded(path)), 'sha256': digest(data), 'bytes': len(data)}


@contextmanager
def locked(directory, create=False):
    directory = guarded(directory)
    if create and not directory.exists():
        directory.mkdir(parents=True, mode=0o700)
    if not directory.is_dir():
        raise ValueError('Campaign directory is missing')
    lock = directory / '.lock'
    guarded(lock)
    if lock.exists() and (not lock.is_file() or lock.stat().st_nlink != 1):
        raise ValueError('Invalid campaign lock')
    with lock.open('a+b') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        if create and not (directory / 'index.json').exists():
            if any(p.name != '.lock' for p in directory.iterdir()):
                raise ValueError('Refusing to initialize nonempty campaign')
            for team in TEAMS:
                (directory / f'{team}.jsonl').touch(exist_ok=False)
            write_json(directory / 'index.json', {team: {'count': 0, 'head': ZERO, 'sha256': digest(b'')} for team in TEAMS})
        yield directory


def checked(directory, expected_seal=None, pending_outputs=()):
    index = read_json(directory / 'index.json')
    if set(index) != set(TEAMS):
        raise ValueError('Invalid team index')
    events, files = [], {'index.json', '.lock', *(f'{team}.jsonl' for team in TEAMS)}
    for team in TEAMS:
        previous, count = ZERO, 0
        log_bytes = read_file(directory / f'{team}.jsonl')
        for line in log_bytes.splitlines():
            event = json.loads(line)
            claimed = event.pop('hash')
            count += 1
            if (set(event) != {'schema', 'team', 'sequence', 'timestamp', 'previous', 'kind', 'data'}
                    or event['schema'] != 1 or event['team'] != team
                    or event['sequence'] != count or event['previous'] != previous
                    or digest(canonical(event)) != claimed):
                raise ValueError('Broken event hash chain')
            for artifact in event['data'].get('artifacts', []):
                path = directory / artifact['name']
                if path.parent != directory or inventory(path)['sha256'] != artifact['sha256']:
                    raise ValueError('Artifact changed or escaped campaign')
                files.add(path.name)
            previous = claimed
            events.append(event)
        if index[team] != {'count': count, 'head': previous, 'sha256': digest(log_bytes)}:
            raise ValueError('Log does not match checkpoint')
    freeze_path = directory / 'freeze.json'
    if freeze_path.exists():
        frozen = read_json(freeze_path)
        if (set(frozen) != {'schema', 'mode', 'inputs', 'signature', 'privacy_enforced'}
                or frozen['schema'] != 1 or frozen['mode'] != MODE or not frozen['inputs']
                or frozen['signature'] is not None or frozen['privacy_enforced'] is not False):
            raise ValueError('Invalid frozen manifest')
        for item in frozen['inputs']:
            if inventory(item['path']) != item:
                raise ValueError('Frozen input changed')
        files.add('freeze.json')
    starts = {e['data']['run_id'] for e in events if e['kind'] == 'run-start'}
    ends = {e['data']['run_id'] for e in events if e['kind'] == 'run-end'}
    seal_path = directory / 'seal.json'
    seal_hash = None
    if seal_path.exists():
        seal = read_json(seal_path)
        if set(seal) != {'schema', 'mode', 'files', 'signature', 'privacy_enforced'} or seal['schema'] != 1:
            raise ValueError('Invalid seal manifest')
        actual = {name: digest(read_file(directory / name)) for name in sorted(files - {'.lock'})}
        if (seal['files'] != actual or starts != ends or seal['mode'] != MODE
                or seal['signature'] is not None or seal['privacy_enforced'] is not False):
            raise ValueError('Seal does not match complete evidence')
        seal_hash = digest(read_file(seal_path))
        files.add('seal.json')
    if expected_seal is not None and seal_hash != expected_seal:
        raise ValueError('External seal anchor mismatch')
    if {p.name for p in directory.iterdir()} != files | set(pending_outputs):
        raise ValueError('Untracked or missing campaign file')
    return {'events': len(events), 'index': index, 'sealed': seal_hash is not None,
            'seal_sha256': seal_hash, 'incomplete_runs': sorted(starts - ends), 'mode': MODE}


def append(directory, team, kind, data, pending_outputs=()):
    if team not in TEAMS or not isinstance(kind, str) or not kind.strip() or not isinstance(data, dict):
        raise ValueError('Invalid event')
    state = checked(directory, pending_outputs=pending_outputs)
    if state['sealed']:
        raise ValueError('Sealed campaign is immutable; open a successor campaign')
    index = state['index']
    event = {'schema': 1, 'team': team, 'sequence': index[team]['count'] + 1,
             'timestamp': datetime.now(timezone.utc).isoformat(), 'previous': index[team]['head'],
             'kind': kind, 'data': data}
    event['hash'] = digest(canonical(event))
    with (directory / f'{team}.jsonl').open('ab') as output:
        output.write(canonical(event) + b'\n')
        output.flush()
        os.fsync(output.fileno())
    index[team] = {'count': event['sequence'], 'head': event['hash'],
                   'sha256': digest(read_file(directory / f'{team}.jsonl'))}
    write_json(directory / 'index.json', index)
    return event


def record_event(directory, team, kind, data):
    if kind in {'run-start', 'run-end', 'freeze'} or 'artifacts' in data:
        raise ValueError('Reserved event kind or field')
    with locked(directory, create=True) as directory:
        return append(directory, team, kind, data)


def freeze(directory, inputs):
    with locked(directory) as directory:
        state = checked(directory)
        if state['sealed'] or (directory / 'freeze.json').exists() or not inputs:
            raise ValueError('Freeze requires nonempty inputs and an unfrozen campaign')
        manifest = {'schema': 1, 'mode': MODE, 'inputs': [inventory(path) for path in inputs],
                    'signature': None, 'privacy_enforced': False}
        # Include this artifact in the event before creating it: append validation
        # checks existing history, not the new event. A crash fails closed.
        data = canonical(manifest) + b'\n'
        append(directory, 'root', 'freeze', {'artifacts': [{'name': 'freeze.json', 'sha256': digest(data)}]})
        write_json(directory / 'freeze.json', manifest)
        return manifest


def _observe_exit(process):
    # WNOWAIT keeps the session/group leader unreaped. Its PID therefore cannot
    # be reused as an unrelated PGID while this function may signal the group.
    return os.waitid(os.P_PID, process.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)


def _live_group_members(group_id, remaining):
    if remaining <= 0:
        raise ValueError('Process-group cleanup deadline exhausted; evidence remains incomplete')
    observed = subprocess.run(GROUP_PROBE, stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              text=True, timeout=remaining, check=False,
                              env={'PATH': os.defpath, 'LANG': 'C'})
    if observed.returncode or observed.stderr:
        raise ValueError('Cannot inspect process group; evidence remains incomplete')
    live = []
    leader_seen = False
    for line in observed.stdout.splitlines():
        fields = line.split()
        if len(fields) != 3 or not fields[0].isdigit() or not fields[1].isdigit():
            raise ValueError('Unsupported process-state observation; evidence remains incomplete')
        pid, group, state = int(fields[0]), int(fields[1]), fields[2]
        if pid == group_id and group == group_id:
            leader_seen = True
        # Zombies have exited and cannot write. Keeping the leader as a zombie
        # until this check completes is deliberate; its final reap is below.
        if group == group_id and not state.startswith('Z'):
            live.append(pid)
    if not leader_seen:
        raise ValueError('Owned group leader absent from observation; evidence remains incomplete')
    return live


def _finish_process_group(process, started, timeout):
    execution_deadline = started + timeout
    cleanup_deadline = execution_deadline + GROUP_CLEANUP_TIMEOUT
    forced = timed_out = False
    reason = None
    cleanup_started = None
    try:
        while _observe_exit(process) is None:
            if time.monotonic() >= execution_deadline:
                timed_out, forced, reason = True, True, 'execution-deadline'
                break
            time.sleep(min(0.01, max(0, execution_deadline - time.monotonic())))
        if not forced:
            forced = bool(_live_group_members(process.pid,
                min(GROUP_CLEANUP_TIMEOUT, cleanup_deadline - time.monotonic())))
            if forced:
                reason = 'live-descendants-after-direct-exit'
        if forced:
            cleanup_started = time.monotonic()
            cleanup_deadline = min(cleanup_deadline, cleanup_started + GROUP_CLEANUP_TIMEOUT)
            while True:
                # Reconfirm that this is still our unreaped child before every
                # signal. If another owner reaped it, waitid fails closed.
                _observe_exit(process)
                signal_error = None
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError) as error:
                    # Some systems return EPERM for a zombie-only group. The
                    # independent live-member observation decides quiescence.
                    signal_error = error
                if not _live_group_members(process.pid, cleanup_deadline - time.monotonic()):
                    break
                if signal_error is not None:
                    raise ValueError('Cannot stop live process group; evidence remains incomplete') from signal_error
                if time.monotonic() >= cleanup_deadline:
                    raise ValueError('Live process group at cleanup deadline; evidence remains incomplete')
                time.sleep(min(0.01, cleanup_deadline - time.monotonic()))
        # No live same-group process remains. Reap only now, and never signal
        # this numeric group again after its ownership anchor has been released.
        process.wait(timeout=max(0, cleanup_deadline - time.monotonic()))
        return {'exit_code': process.returncode, 'timed_out': timed_out,
                'group_cleanup_forced': forced, 'group_cleanup_reason': reason,
                'group_cleanup_seconds': 0 if cleanup_started is None else time.monotonic() - cleanup_started,
                'group_quiescent': True}
    except BaseException:
        # Best-effort stop on observation failure, but do not hash, end or seal
        # the run without a successful quiescence observation. No PID-only kill.
        if process.returncode is None:
            try:
                _observe_exit(process)
                os.killpg(process.pid, signal.SIGKILL)
            except OSError:
                pass
            # No more signals follow this final reap attempt. Evidence still
            # remains incomplete even if only the direct child is now reaped.
            try:
                process.wait(timeout=max(0, min(0.1, cleanup_deadline - time.monotonic())))
            except (ChildProcessError, subprocess.TimeoutExpired):
                pass
        raise


def run(directory, team, cwd, argv, timeout=30, reviewed=False):
    cwd = guarded(cwd)
    if (not reviewed or not cwd.is_dir() or not isinstance(argv, list) or not argv
            or any(not isinstance(arg, str) or '\x00' in arg for arg in argv)
            or not Path(argv[0]).is_absolute() or not math.isfinite(timeout) or not 0 < timeout <= 3600):
        raise ValueError('Require reviewed argv, absolute executable, valid cwd and bounded timeout')
    executable = Path(argv[0]).resolve(strict=True)
    executable_sha = digest(executable.read_bytes())
    with locked(directory) as directory:
        state = checked(directory)
        if state['sealed'] or state['incomplete_runs'] or not (directory / 'freeze.json').exists():
            raise ValueError('Run requires frozen, complete, unsealed evidence')
        run_id = uuid.uuid4().hex
        command = [str(executable), *argv[1:]]
        append(directory, team, 'run-start', {'run_id': run_id, 'mode': MODE, 'argv': command,
               'cwd': str(cwd), 'timeout_seconds': timeout,
               'cleanup_timeout_seconds': GROUP_CLEANUP_TIMEOUT,
               'total_deadline_seconds': timeout + GROUP_CLEANUP_TIMEOUT,
               'group_probe_argv': GROUP_PROBE, 'executable_sha256': executable_sha,
               'privacy_enforced': False, 'environment_keys': ['PATH', 'LANG', 'TMPDIR', 'PYTHONDONTWRITEBYTECODE']})
        paths = [directory / f'{run_id}.{stream}' for stream in ('stdout', 'stderr')]
        started, launch_error = time.monotonic(), None
        lifecycle = {'exit_code': None, 'timed_out': False, 'group_cleanup_forced': False,
                     'group_cleanup_reason': None, 'group_cleanup_seconds': 0, 'group_quiescent': None}
        with paths[0].open('xb') as stdout, paths[1].open('xb') as stderr:
            try:
                process = subprocess.Popen(command, cwd=cwd, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                    shell=False, start_new_session=True,
                    env={'PATH': os.defpath, 'LANG': 'C.UTF-8', 'TMPDIR': str(cwd), 'PYTHONDONTWRITEBYTECODE': '1'})
            except OSError as error:
                launch_error = str(error)
            else:
                lifecycle = _finish_process_group(process, started, timeout)
        # Newly created outputs are intentionally not yet in the inventory.
        artifacts = [{'name': p.name, 'sha256': inventory(p)['sha256']} for p in paths]
        # Verify prior evidence while allowing these two newly created names.
        # The terminal event immediately binds their hashes.
        status = ('launch-error' if launch_error else 'timeout' if lifecycle['timed_out']
                  else 'descendants-terminated' if lifecycle['group_cleanup_forced'] else 'completed')
        result = {'run_id': run_id, 'mode': MODE, **lifecycle,
                  'launch_error': launch_error, 'elapsed_seconds': time.monotonic() - started,
                  'artifacts': artifacts, 'status': status}
        append(directory, team, 'run-end', result, pending_outputs={p.name for p in paths})
        return result


def seal(directory):
    with locked(directory) as directory:
        state = checked(directory)
        if state['sealed'] or state['incomplete_runs'] or not (directory / 'freeze.json').exists():
            raise ValueError('Seal requires frozen, complete, unsealed evidence')
        files = {p.name: digest(read_file(p)) for p in directory.iterdir() if p.name != '.lock'}
        write_json(directory / 'seal.json', {'schema': 1, 'mode': MODE, 'files': files,
                   'signature': None, 'privacy_enforced': False})
        return checked(directory)


def verify(directory, expected_seal=None):
    with locked(directory) as directory:
        return checked(directory, expected_seal)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--campaign', required=True)
    commands = parser.add_subparsers(dest='verb', required=True)
    record = commands.add_parser('record-event')
    record.add_argument('--team', choices=TEAMS, required=True)
    record.add_argument('--kind', required=True)
    record.add_argument('--data', required=True, help='Visible JSON object; no secrets or hidden reasoning')
    freezer = commands.add_parser('freeze')
    freezer.add_argument('inputs', nargs='+')
    runner = commands.add_parser('run')
    runner.add_argument('--team', choices=TEAMS, required=True)
    runner.add_argument('--cwd', required=True)
    runner.add_argument('--timeout', type=float, default=30)
    runner.add_argument('--reviewed', action='store_true')
    runner.add_argument('command', nargs=argparse.REMAINDER)
    commands.add_parser('seal')
    verifier = commands.add_parser('verify')
    verifier.add_argument('--expected-seal')
    args = parser.parse_args(argv)
    try:
        if args.verb == 'record-event':
            result = record_event(args.campaign, args.team, args.kind, json.loads(args.data))
        elif args.verb == 'freeze':
            result = freeze(args.campaign, args.inputs)
        elif args.verb == 'run':
            command = args.command[1:] if args.command[:1] == ['--'] else args.command
            result = run(args.campaign, args.team, args.cwd, command, args.timeout, args.reviewed)
        elif args.verb == 'seal':
            result = seal(args.campaign)
        else:
            result = verify(args.campaign, args.expected_seal)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 1 if (result.get('timed_out') or result.get('launch_error')
                     or result.get('group_cleanup_forced') or result.get('exit_code', 0) not in (0, None)) else 0
    except (ValueError, OSError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        print(json.dumps({'status': 'invalid', 'error': str(error)}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
