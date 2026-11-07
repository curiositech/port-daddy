#!/usr/bin/env python3
"""Stage/run one fixed reviewed Python checker in the existing offline VM profile."""
import argparse
import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import time
import zlib

sys.dont_write_bytecode = True
import run as base

ROOT = base.ROOT
SOURCE = base.SOURCE
CACHE = base.CACHE / 'python-runtime'
EVIDENCE = ROOT / 'docs/harbor-research/campaigns/2026-11-06/guest-python'
base.EVIDENCE = EVIDENCE
base.TRANSCRIPT = EVIDENCE / 'transcript.jsonl'
REPOSITORY = 'https://dl-cdn.alpinelinux.org/alpine/v3.22/main/aarch64/'
PAYLOAD = ROOT / 'skills/harbor-results/scripts/scout_claim_counterexamples.py'
PYTHON_VERSION = '3.12.16-r0'
LIMIT = 128 * 1024 * 1024


def download(filename):
    if not re.fullmatch(r'[A-Za-z0-9_.+~-]+', filename):
        raise ValueError('invalid fixed repository artifact filename')
    path = CACHE / filename
    if not path.exists():
        base.command(['/usr/bin/curl', '--fail', '--location', '--proto', '=https', '--proto-redir', '=https',
                      '--tlsv1.2', '--max-time', '90', '--max-filesize', '33554432', '--output', str(path), REPOSITORY + filename])
    if path.stat().st_size > 33554432:
        raise ValueError('compressed artifact exceeds 32 MiB')
    base.record({'kind': 'download_identity', 'url': REPOSITORY + filename, 'sha256': base.digest(path),
                 'bytes': path.stat().st_size, 'provenance': 'official HTTPS; observed digest; upstream signature not verified'})
    return path


def archive(path):
    remaining = path.read_bytes()
    expanded = bytearray()
    while remaining:
        decoder = zlib.decompressobj(31)
        expanded.extend(decoder.decompress(remaining, LIMIT - len(expanded)))
        if not decoder.eof or decoder.unconsumed_tail or len(expanded) >= LIMIT:
            raise ValueError('archive exceeds fixed 128 MiB expansion ceiling')
        remaining = decoder.unused_data
    return tarfile.open(fileobj=io.BytesIO(expanded), mode='r:', ignore_zeros=True)


def packages():
    index = download('APKINDEX.tar.gz')
    with archive(index) as tar:
        text = tar.extractfile('APKINDEX').read().decode()
    entries = {}
    providers = {}
    for paragraph in text.split('\n\n'):
        fields = dict(line.split(':', 1) for line in paragraph.splitlines() if ':' in line)
        if 'P' not in fields:
            continue
        entries[fields['P']] = fields
        for provide in fields.get('p', '').split():
            providers.setdefault(re.split('[<>=~]', provide)[0], []).append(fields['P'])
    if entries['python3']['V'] != PYTHON_VERSION:
        raise ValueError('Python version changed; review and repin before download')
    selected = {}
    queue = ['python3']
    while queue:
        name = queue.pop()
        if name in selected:
            continue
        entry = entries[name]
        selected[name] = entry
        for dependency in entry.get('D', '').split():
            if dependency.startswith('!'):
                raise ValueError('conflict dependency needs manual review')
            key = re.split('[<>=~]', dependency)[0]
            if key in entries:
                queue.append(key)
            else:
                choices = providers.get(key, [])
                if len(choices) != 1:
                    raise ValueError('ambiguous or absent dependency: ' + dependency)
                queue.append(choices[0])
    lock = []
    for name, entry in sorted(selected.items()):
        filename = name + '-' + entry['V'] + '.apk'
        path = download(filename)
        lock.append({'name': name, 'version': entry['V'], 'url': REPOSITORY + filename,
                     'filename': filename, 'sha256': base.digest(path), 'bytes': path.stat().st_size,
                     'dependencies': entry.get('D', '').split(), 'index_checksum': entry.get('C')})
    return {'repository': REPOSITORY, 'python_version': PYTHON_VERSION, 'index_sha256': base.digest(index),
            'provenance': 'official HTTPS artifact bytes pinned by observed SHA-256; upstream signatures not verified', 'packages': lock}


def runtime_files(lock):
    files = {}
    total = 0
    for package in lock['packages']:
        path = CACHE / package['filename']
        if base.digest(path) != package['sha256']:
            raise ValueError('package digest mismatch')
        with archive(path) as tar:
            for member in tar:
                name = member.name.removeprefix('./')
                parts = PurePosixPath(name).parts
                if name.startswith('.'):
                    continue  # APK metadata/install hooks are inert, never executed.
                if name.startswith('/') or '..' in parts:
                    raise ValueError('unsafe package member')
                if not (name.startswith('lib/') or name.startswith('usr/lib/') or name in ('usr/bin/python3', 'usr/bin/python3.12')):
                    continue
                if member.isdir():
                    continue
                if member.isfile():
                    if member.size > 64 * 1024 * 1024:
                        raise ValueError('oversized package member')
                    content = tar.extractfile(member).read()
                    mode = 0o100000 | (member.mode & 0o777)
                elif member.issym():
                    # Links exist only as bytes in guest cpio; never host filesystem links.
                    if member.linkname.startswith('/'):
                        raise ValueError('absolute runtime symlink requires review')
                    content = member.linkname.encode()
                    mode = 0o120777
                else:
                    raise ValueError('unsupported runtime member type')
                total += len(content)
                if total > LIMIT:
                    raise ValueError('aggregate runtime exceeds fixed ceiling')
                value = (mode, content)
                if name in files and files[name] != value:
                    raise ValueError('conflicting runtime path ' + name)
                files[name] = value
    return files


def prepare():
    lock = packages()
    files = runtime_files(lock)
    target = base.CACHE / ('python-' + os.urandom(6).hex())
    target.mkdir()
    payload = PAYLOAD.read_bytes()
    negative = b'assert False, "INTENTIONAL_NEGATIVE_CONTROL"\n'
    manifest = {'kind': 'fixed-python-proof-v1', 'payload_source': str(PAYLOAD.relative_to(ROOT)),
                'payload_sha256': hashlib.sha256(payload).hexdigest(),
                'negative_control_sha256': hashlib.sha256(negative).hexdigest(),
                'python_version': PYTHON_VERSION, 'runtime_lock_sha256': hashlib.sha256(json.dumps(lock, sort_keys=True).encode()).hexdigest(),
                'positive_command': ['/usr/bin/python3', '-I', '-B', '/proof/payload.py'],
                'negative_command': ['/usr/bin/python3', '-I', '-B', '/proof/negative.py'],
                'expected_exit_codes': {'positive': 0, 'negative': 1}, 'boundary_profile': 'proof-offline-v1'}
    archive_bytes = io.BytesIO()
    with tarfile.open(fileobj=archive_bytes, mode='w', format=tarfile.USTAR_FORMAT) as tar:
        for name, data in [('payload.py', payload), ('negative.py', negative), ('manifest.json', (json.dumps(manifest, sort_keys=True) + '\n').encode())]:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o444
            info.mtime = 0
            tar.addfile(info, io.BytesIO(data))
    token = 'python-fixed-input-' + os.urandom(8).hex()
    input_bytes = token.encode().ljust(4096, b'\0') + archive_bytes.getvalue()
    input_bytes += b'\0' * (-len(input_bytes) % 4096)
    (target / 'input.raw').write_bytes(input_bytes)
    (target / 'kernel').write_bytes(base.kernel_image())
    init = (SOURCE / 'proof-init.sh').read_text()
    block = (SOURCE / 'python-workload.sh').read_text().replace('@PAYLOAD_SHA256@', manifest['payload_sha256']).replace('@NEGATIVE_SHA256@', manifest['negative_control_sha256'])
    init = init.replace('echo PROOF_DONE\nsync\npoweroff -f', block + '\necho PROOF_DONE\nsync\npoweroff -f')
    files['proof-init'] = (0o100755, init.encode())
    directories = set()
    for name in files:
        directories.update(str(p) for p in PurePosixPath(name).parents if str(p) != '.')
    entries = []
    inode = 100000
    for name in sorted(directories, key=lambda p: (p.count('/'), p)):
        entries.append(base.cpio_entry(name, b'', 0o040755, inode)); inode += 1
    for name, (mode, content) in sorted(files.items()):
        entries.append(base.cpio_entry(name, content, mode, inode)); inode += 1
    entries.append(base.cpio_entry('TRAILER!!!', b'', 0, inode))
    overlay = gzip.compress(b''.join(entries), mtime=0)
    (target / 'initrd').write_bytes((base.CACHE / 'initramfs-virt').read_bytes() + overlay)
    with (target / 'state.raw').open('xb') as stream:
        stream.truncate(8388608)
    for name in ('kernel', 'initrd', 'input.raw'):
        (target / name).chmod(0o400)
    manifest['python_binary_sha256'] = hashlib.sha256(files['usr/bin/python3.12'][1]).hexdigest()
    manifest.update({'staging_directory': str(target), 'input_token': token, 'runtime_files': len(files),
                     'runtime_file_bytes': sum(len(value[1]) for value in files.values()),
                     'sha256': {name: base.digest(target / name) for name in ('kernel', 'initrd', 'input.raw', 'state.raw')},
                     'helper_sha256': base.digest(base.CACHE / 'proof-guest'),
                     'controller_sha256': base.digest(Path(__file__)), 'guest_workload_sha256': base.digest(SOURCE / 'python-workload.sh')})
    (EVIDENCE / 'runtime-lock.json').write_text(json.dumps(lock, indent=2) + '\n')
    (EVIDENCE / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    base.record({'kind': 'staged_fixed_python', **manifest})
    print(json.dumps(manifest, indent=2))


def execute():
    manifest = json.loads((EVIDENCE / 'manifest.json').read_text())
    target = Path(manifest['staging_directory'])
    if target.parent != base.CACHE or not target.name.startswith('python-') or target.is_symlink():
        raise ValueError('unexpected fixed guest staging directory')
    for name, expected in manifest['sha256'].items():
        if base.digest(target / name) != expected:
            raise ValueError('sealed input changed: ' + name)
    if base.digest(Path(__file__)) != manifest['controller_sha256'] or base.digest(SOURCE / 'python-workload.sh') != manifest['guest_workload_sha256']:
        raise ValueError('reviewed controller or guest workload changed; prepare a new manifest')
    if base.digest(base.CACHE / 'proof-guest') != manifest['helper_sha256']:
        raise ValueError('reviewed helper changed')
    result = {'scope': 'one fixed Python research checker and intentional assertion control inside an offline guest', 'verdict': 'INCOMPLETE'}
    try:
        response = base.command([str(base.CACHE / 'proof-guest'), str(target)], timeout=70)
        events = [json.loads(line) for line in response['stdout'].splitlines()]
        serial = b''.join(base64.b64decode(e['base64']) for e in events if e.get('event') == 'serial').decode(errors='replace')
        log = EVIDENCE / ('guest-' + str(time.time_ns()) + '.log')
        log.write_text(serial)
        config = next(e for e in events if e.get('event') == 'configuration')
        started = next(e for e in events if e.get('event') == 'started')
        markers = ['PROOF_BOOTED', 'PROOF_TWO_DISKS', 'PROOF_READONLY_DENIED', 'PROOF_STATE_WRITE_OK', 'PROOF_CROSSREAD_ABSENT',
                   'PROOF_ONLY_LOOPBACK', 'PROOF_NETWORK_DENIED', 'PYTHON_PAYLOAD_HASH_OK', 'PYTHON_POSITIVE_EXIT=0',
                   'PYTHON_NEGATIVE_EXIT=1', 'PYTHON_NEGATIVE_CONTROL_OK', 'INTENTIONAL_NEGATIVE_CONTROL', 'PROOF_DONE']
        positive_text = serial.split('PYTHON_POSITIVE_BEGIN', 1)[1].split('PYTHON_POSITIVE_EXIT=', 1)[0].strip()
        observed = json.loads(positive_text)
        expected = {
            'D14': {'bounded_positive_cases': 2168, 'conserved_balance': '9/5', 'unsplit_payoff': '1', 'split_payoff': '9/5'},
            'D8': {'worlds': 4, 'digest_cells': 2, 'zero_miss_opening_loss': '0', 'full_guess_risk': '0', 'digest_guess_risk': '1/2'},
            'D29': {'schedules': 6, 'violating_schedules': 4, 'witness': ['a.read', 'b.read', 'a.grant', 'b.grant'], 'atomic_orders_checked': 2}}
        checks = {'research_results_exact': observed == expected,
                  'python_version_observed': 'Python 3.12.16' in serial.splitlines(),
                  'python_binary_hash_observed': manifest['python_binary_sha256'] + '  /usr/bin/python3.12' in serial.splitlines(),
                  'required_markers': all(marker in serial for marker in markers),
                  'readonly_input_unchanged': base.digest(target / 'input.raw') == manifest['sha256']['input.raw'],
                  'private_state_write': (target / 'state.raw').read_bytes().startswith(b'guest-state-ok'),
                  'host_devices_absent': all(config[k] == 0 for k in ('network_devices', 'directory_sharing_devices', 'socket_devices')),
                  'runtime_devices_absent': all(started[k] == 0 for k in ('runtime_network_devices', 'runtime_directory_sharing_devices', 'runtime_socket_devices')),
                  'guest_stopped': any(e.get('event') == 'guest_stopped' for e in events),
                  'no_failure_marker': 'FAILED' not in serial and 'HASH_MISMATCH' not in serial}
        result.update({'research_results': observed, 'checks': checks, 'verdict': 'PASS' if all(checks.values()) else 'INCOMPLETE',
                       'guest_log': log.name, 'host_events': [e for e in events if e['witness'] == 'HOST_OBSERVED'],
                       'manifest_sha256': base.digest(EVIDENCE / 'manifest.json'), 'vm_exit_code': response['exit_code']})
    except Exception as error:
        result['error'] = str(error)
    finally:
        (target / 'state.raw').unlink()
        base.record({'kind': 'teardown', 'state_disk_removed': not (target / 'state.raw').exists(), 'staging_directory': str(target)})
    base.record({'kind': 'verdict', **result})
    (EVIDENCE / 'verdict.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    return 0 if result['verdict'] == 'PASS' else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('prepare', 'run'))
    args = parser.parse_args()
    expected = Path('/Users/erichowens/coding/tmp/research-program-next-result-20261106')
    branch = subprocess.check_output(['/usr/bin/git', 'branch', '--show-current'], cwd=ROOT, env={'PATH': '/usr/bin:/bin'}).decode().strip()
    if ROOT != expected or not (ROOT / '.git').is_file() or branch != 'codex/research-program-next-result-20261106':
        raise SystemExit('refusing writes outside authorized linked worktree and branch')
    CACHE.mkdir(exist_ok=True)
    EVIDENCE.mkdir(exist_ok=True)
    if args.action == 'prepare':
        prepare()
    else:
        raise SystemExit(execute())
