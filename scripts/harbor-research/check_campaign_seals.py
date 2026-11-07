#!/usr/bin/env python3
"""Verify four original campaign inventories and the atomic-admission round.

This checks retained byte identities against recorded anchors, not authorship,
completeness, proof validity or private transcript availability. No extraction.
"""
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile

ROOT = Path(__file__).resolve().parents[2]
CAMPAIGN = ROOT / 'docs/harbor-research/campaigns/2026-11-06'
ANCHORS = {
    'red': '9214dd9e55c9d15555dc2ccb73047e9f279fa2c8230731250717c126017978c5',
    'white': '6d4da545af5fbf9be21bc4932067adeb2ad6f966d6cd777d8e76d4d54d810244',
    'red-retest': '5a8813832943c86ce28d39b80b7ee7688b46b41cd7eb4ee5ccabc4775660c994',
    'guest-python': 'b06a66b42b39b29d90d940c554898ac19341fb2d7fcaa395c108c3421358b741',
}


ROUND_TWO_ANCHOR = '5021d42a28538e86908227b5d2552ef4c0a0224f7d65dfdc0ec11dcb2fdfd4e6'

def require(value, message):
    if not value:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def retained_bytes(base, name):
    relative = PurePosixPath(name)
    require(not relative.is_absolute() and '..' not in relative.parts, 'unsafe evidence path')
    path = base.joinpath(*relative.parts)
    require(path.resolve().is_relative_to(base.resolve()), 'evidence path escapes lane')
    archive = path.with_name(path.name + '.zip')
    if archive.exists():
        require(not archive.is_symlink(), 'archive must not be a symlink')
        with zipfile.ZipFile(archive) as container:
            require(container.namelist() == [path.name], 'archive must contain exactly the original member')
            member = container.getinfo(path.name)
            require(member.file_size <= 262144, 'archived input exceeds limit')
            data = container.read(member)
        if path.exists():
            require(not path.is_symlink() and path.read_bytes() == data, 'raw/archive drift')
        return data, 'archive'
    require(path.is_file() and not path.is_symlink(), 'missing or linked evidence: ' + name)
    return path.read_bytes(), 'file'


def main():
    total = archived = 0
    for lane, expected in ANCHORS.items():
        directory = CAMPAIGN / lane
        raw = (directory / 'seal.json').read_bytes()
        require(digest(raw) == expected, 'outer seal changed: ' + lane)
        seal = json.loads(raw)
        files = seal.get('files', seal.get('sha256', {}))
        require(bool(files), 'empty inventory: ' + lane)
        for name, expected_digest in files.items():
            data, form = retained_bytes(directory, name)
            require(digest(data) == expected_digest, 'evidence changed: ' + lane + '/' + name)
            total += 1
            archived += form == 'archive'
        for name, expected_digest in seal.get('external_artifacts', {}).items():
            data, _ = retained_bytes(ROOT, name)
            require(digest(data) == expected_digest, 'external artifact changed: ' + name)
        print(f'PASS {lane}: {len(files)} frozen files')
    print(f'PASS: {total} inventory entries; {archived} archive-backed input; four original outer seals')
    directory = CAMPAIGN / 'round-two'
    raw = (directory / 'seal.json').read_bytes()
    require(digest(raw) == ROUND_TWO_ANCHOR, 'round-two outer seal changed')
    files = json.loads(raw)['files']
    require(bool(files), 'round-two inventory empty')
    for name, expected_digest in files.items():
        data, _ = retained_bytes(directory, name)
        require(digest(data) == expected_digest, 'round-two evidence changed: ' + name)
    print(f'PASS round-two: {len(files)} retained artifacts')


if __name__ == '__main__':
    main()
