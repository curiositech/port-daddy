#!/usr/bin/env python3
"""Normalise a recorded terminal transcript for print: stable placeholders for
ids, timestamps and PIDs; ASCII only. Used by record_sessions.sh."""
import re
import sys

RULES = [
    (r'\d{4}-\d{2}-\d{2}T[\d:.]+Z', '<timestamp>'),
    (r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}', '<timestamp>'),
    (r'\b[0-9A-HJKMNP-TV-Z]{26}\b', '<actor-id>'),
    (r'\b[0-9A-HJKMNP-TV-Z]{24}\b', '<actor-id>'),
    (r'PID \d+', 'PID <pid>'),
    (r'Expires in: \d+s', 'Expires in: <n>s'),
    (r'^⚠.*$', ''),
    (r'✓', '[ok]'), (r'—', '--'), (r'→', '->'), (r'─+', lambda m: '-' * len(m.group(0))),
    (r'[ \t]+$', ''),
]


def normalise(text: str) -> str:
    for pat, rep in RULES:
        text = re.sub(pat, rep, text, flags=re.M)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return ''.join(ch if ord(ch) < 128 or ch == '\n' else '?' for ch in text)


if __name__ == '__main__':
    sys.stdout.write(normalise(sys.stdin.read()))
