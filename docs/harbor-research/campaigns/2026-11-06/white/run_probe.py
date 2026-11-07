#!/usr/bin/env python3
"""Reviewed bounded proof runs, with raw bytes retained by war_room."""
import sys
sys.dont_write_bytecode = True
import importlib.util, json, hashlib
from pathlib import Path
WHITE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('war_room', WHITE / 'inputs/war_room.py')
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)
ledger = WHITE / 'evidence'
if not ledger.exists():
    w.record_event(ledger, 'white', 'assignment', {
        'round': '2026-11-06-R1', 'gate': 'B', 'privacy_enforced': False,
        'scope': 'isolation.pv, isolation.run.log and white/',
        'red_seal_sha256': '9214dd9e55c9d15555dc2ccb73047e9f279fa2c8230731250717c126017978c5',
        'message': 'Repair R1-RED-001/002/003. Require positive traces and intended mutation failures. WHITE cannot self-close; fresh RED retest required.'})
    w.freeze(ledger, sorted((WHITE / 'inputs').iterdir()))
name = sys.argv[1]
model = Path(sys.argv[-1])
if model.is_file():
    w.record_event(ledger, 'white', 'probe-input', {'name': name, 'path': str(model), 'sha256': hashlib.sha256(model.read_bytes()).hexdigest()})
result = w.run(ledger, 'white', WHITE, sys.argv[2:], timeout=60, reviewed=True)
streams = {a['name'].rsplit('.', 1)[1]: (ledger / a['name']).read_text() for a in result['artifacts']}
summary = {'name': name, **result, 'results': [line for line in streams['stdout'].splitlines() if line.startswith('RESULT ')]}
with (WHITE / 'run-index.jsonl').open('a') as out:
    out.write(json.dumps(summary, sort_keys=True) + '\n')
print(json.dumps(summary, indent=2))
raise SystemExit(0 if result['exit_code'] == 0 and not result['timed_out'] else 1)
