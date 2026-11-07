#!/usr/bin/env python3
"""DEV_UNTRUSTED, fixed proof VM experiment; never an agent launcher."""
import argparse
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time
import struct
import zlib

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'scripts/harbor-research/proof-guest'
CACHE = ROOT / '.cache/proof-guest'
EVIDENCE = ROOT / 'docs/harbor-research/campaigns/2026-11-06/isolation'
TRANSCRIPT = EVIDENCE / 'transcript.jsonl'
BASE_URL = 'https://dl-cdn.alpinelinux.org/alpine/v3.22/releases/aarch64/netboot/'
ENV = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'TMPDIR': str(CACHE), 'LC_ALL': 'C'}


def record(value):
    value['at_utc'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    with TRANSCRIPT.open('a') as stream:
        stream.write(json.dumps(value, sort_keys=True) + '\n')


def command(args, timeout=120):
    started = time.monotonic()
    process = subprocess.Popen(args, cwd=ROOT, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    timed_out = False
    try:
        out, err = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(process.pid, signal.SIGKILL)
        out, err = process.communicate()
    result = {'kind': 'command', 'argv': args, 'cwd': str(ROOT), 'exit_code': process.returncode,
              'stdout': out.decode(errors='replace'), 'stderr': err.decode(errors='replace'),
              'timeout': timed_out, 'elapsed_seconds': round(time.monotonic() - started, 3)}
    record(result)
    if timed_out or process.returncode:
        raise RuntimeError(json.dumps(result))
    return result


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cpio_entry(name, data, mode=0o100755, inode=1):
    name = name.encode() + b'\0'
    fields = [inode, mode, 0, 0, 1, 0, len(data), 0, 0, 0, 0, len(name), 0]
    header = b'070701' + ''.join(f'{v:08x}' for v in fields).encode()
    value = header + name
    value += b'\0' * (-len(value) % 4)
    value += data
    return value + b'\0' * (-len(data) % 4)


def build():
    CACHE.mkdir(parents=True, exist_ok=True)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    for args in [['/usr/bin/swiftc', '--version'], ['/usr/bin/sw_vers'], ['/usr/bin/uname', '-m'],
                 ['/usr/bin/git', 'rev-parse', '--show-toplevel'], ['/usr/bin/git', 'branch', '--show-current'],
                 ['/usr/bin/git', 'rev-parse', '--git-dir']]:
        command(args)
    for filename in ('vmlinuz-virt', 'initramfs-virt'):
        target = CACHE / filename
        if not target.exists():
            command(['/usr/bin/curl', '--fail', '--location', '--proto', '=https', '--tlsv1.2', '--max-time', '90', '--output', str(target), BASE_URL + filename])
        record({'kind': 'download_identity', 'url': BASE_URL + filename, 'sha256': digest(target), 'bytes': target.stat().st_size,
                'provenance': 'official HTTPS endpoint; upstream signature not independently verified'})
    command(['/usr/bin/file', str(CACHE / 'vmlinuz-virt'), str(CACHE / 'initramfs-virt')])
    command(['/usr/bin/swiftc', '-module-cache-path', str(CACHE / 'module-cache'), str(SOURCE / 'ProofGuest.swift'), '-o', str(CACHE / 'proof-guest')])
    command(['/usr/bin/codesign', '--force', '--sign', '-', '--entitlements', str(SOURCE / 'virtualization.entitlements'), str(CACHE / 'proof-guest')])
    record({'kind': 'build_identity', 'status': 'DEV_UNTRUSTED', 'binary_sha256': digest(CACHE / 'proof-guest'),
            'source_sha256': digest(SOURCE / 'ProofGuest.swift'), 'guest_init_sha256': digest(SOURCE / 'proof-init.sh')})


def kernel_image():
    raw = (CACHE / 'vmlinuz-virt').read_bytes()
    if raw[4:8] == b'zimg':
        offset, size = struct.unpack_from('<II', raw, 8)
        if raw[24:28] != b'gzip' or not (64 <= offset < len(raw)) or offset + size > len(raw):
            raise RuntimeError('unsupported or malformed EFI zboot image')
        decoder = zlib.decompressobj(31)
        image = decoder.decompress(raw[offset:offset + size], 64 * 1024 * 1024)
        if not decoder.eof or decoder.unconsumed_tail or len(image) >= 64 * 1024 * 1024:
            raise RuntimeError('kernel decompression exceeds fixed bound')
    else:
        image = raw
    if image[56:60] != b'ARM\x64':
        raise RuntimeError('expected uncompressed Linux arm64 Image magic')
    record({'kind': 'kernel_normalization', 'source_sha256': digest(CACHE / 'vmlinuz-virt'),
            'image_sha256': hashlib.sha256(image).hexdigest(), 'image_bytes': len(image),
            'method': 'EFI zboot header payload gzip decoding; no code execution'})
    return image


def stage(team):
    target = CACHE / (team + '-' + os.urandom(6).hex())
    target.mkdir(exist_ok=False)
    (target / 'kernel').write_bytes(kernel_image())
    original = (CACHE / 'initramfs-virt').read_bytes()
    overlay = cpio_entry('proof-init', (SOURCE / 'proof-init.sh').read_bytes()) + cpio_entry('TRAILER!!!', b'', mode=0, inode=2)
    (target / 'initrd').write_bytes(original + gzip.compress(overlay, mtime=0))
    token = team + '-private-input-' + os.urandom(16).hex()
    (target / 'input.raw').write_bytes(token.encode().ljust(4096, b'\0'))
    with (target / 'state.raw').open('xb') as stream:
        stream.truncate(8388608)
    for name in ('kernel', 'initrd', 'input.raw'):
        (target / name).chmod(0o400)
    record({'kind': 'staged_input', 'team': team, 'path': str(target),
            'sha256': {name: digest(target / name) for name in ('kernel', 'initrd', 'input.raw', 'state.raw')}})
    return target, token


def run():
    results = []
    staged = {team: stage(team) for team in ('red', 'blue', 'white')}
    for team, (target, token) in staged.items():
        before = digest(target / 'input.raw')
        try:
            response = command([str(CACHE / 'proof-guest'), str(target)], timeout=70)
            events = [json.loads(line) for line in response['stdout'].splitlines()]
            serial = b''.join(base64.b64decode(e['base64']) for e in events if e.get('event') == 'serial').decode(errors='replace')
            (EVIDENCE / (team + '-guest.log')).write_text(serial)
            required = ['PROOF_BOOTED', 'PROOF_TWO_DISKS', 'PROOF_OWN_INPUT=' + token, 'PROOF_READONLY_DENIED',
                        'PROOF_STATE_WRITE_OK', 'PROOF_CROSSREAD_ABSENT', 'PROOF_ONLY_LOOPBACK', 'PROOF_NETWORK_DENIED', 'PROOF_DONE']
            config = next(e for e in events if e.get('event') == 'configuration')
            started = next(e for e in events if e.get('event') == 'started')
            checks = {'guest_markers': all(marker in serial for marker in required),
                      'no_guest_failure': 'PROOF_READONLY_FAILED' not in serial and 'PROOF_NETWORK_FAILED' not in serial,
                      'readonly_input_unchanged': digest(target / 'input.raw') == before,
                      'state_write_observed': (target / 'state.raw').read_bytes().startswith(b'guest-state-ok'),
                      'host_devices_absent': all(config[k] == 0 for k in ('network_devices', 'directory_sharing_devices', 'socket_devices')),
                      'runtime_devices_absent': all(started[k] == 0 for k in ('runtime_network_devices', 'runtime_directory_sharing_devices', 'runtime_socket_devices')),
                      'guest_stopped': any(e.get('event') == 'guest_stopped' for e in events)}
            results.append({'team': team, 'checks': checks, 'pass': all(checks.values())})
        except Exception as error:
            results.append({'team': team, 'pass': False, 'error': str(error)})
        finally:
            # Only the fixed disposable state disk is removed; guest artifacts are never mounted or extracted.
            (target / 'state.raw').unlink()
            record({'kind': 'teardown', 'team': team, 'state_disk_removed': not (target / 'state.raw').exists()})
    value = {'verdict': 'PASS' if all(r['pass'] for r in results) else 'INCOMPLETE',
             'scope': 'three sequential fixed pure-proof VM runs only; not agent containment or production Drydock',
             'controller_status': 'DEV_UNTRUSTED', 'results': results}
    (EVIDENCE / 'verdict.json').write_text(json.dumps(value, indent=2) + '\n')
    record({'kind': 'verdict', **value})
    print(json.dumps(value, indent=2))
    return 0 if value['verdict'] == 'PASS' else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['build', 'run'])
    args = parser.parse_args()
    expected = Path('/Users/erichowens/coding/tmp/research-program-next-result-20261106')
    branch = subprocess.check_output(['/usr/bin/git', 'branch', '--show-current'], cwd=ROOT, env={'PATH': '/usr/bin:/bin'}).decode().strip()
    if ROOT != expected or not (ROOT / '.git').is_file() or branch != 'codex/research-program-next-result-20261106':
        raise SystemExit('refusing writes outside the authorized linked worktree and feature branch')
    if args.action == 'build':
        build()
    else:
        raise SystemExit(run())
