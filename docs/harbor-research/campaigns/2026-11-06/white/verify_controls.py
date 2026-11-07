#!/usr/bin/env python3
"""Read-only, fail-closed replay of this bounded isolation proof and mutants."""
import argparse
from pathlib import Path
import subprocess

WHITE = Path(__file__).resolve().parent
ROOT = Path(__file__).resolve().parents[5]

def sections(output):
    return output.split('-- Query ')[1:]

def check_false(output, query, witness):
    selected = [s for s in sections(output) if s.splitlines()[0].startswith(query + ' in process')]
    assert len(selected) == 1, ('missing/duplicate query', query)
    section = selected[0]
    assert 'RESULT ' + query + ' is false.' in section, query
    assert 'A trace has been found.' in section, ('no concrete trace', query)
    trace = section.split('A more detailed output of the traces is available with')[-1]
    for token in witness:
        assert token in trace, ('wrong witness', query, token)
    return trace

def verify(outputs):
    positive = outputs['repaired']
    lines = [s for s in positive.splitlines() if s.startswith('RESULT ')]
    assert len(lines) == 10, lines
    assert all(s.endswith(' is true.') for s in lines[:6]), lines[:6]
    for query, tokens in [
        ('not event(RedWrites(red_msg[]))', ['event RedWrites(red_msg)']),
        ('not event(DefenseWrites(def_msg[]))', ['event DefenseWrites(def_msg)']),
        ('not event(DefenseLearnsRed(manifest_id[],red_msg[]))', ['event DefenseLearnsRed(manifest_id,red_msg)']),
        ('not event(JointRoles(manifest_id[],red_msg[],def_msg[]))', ['event RedWrites(red_msg)', 'event DefenseWrites(def_msg)', 'event DefenseLearnsRed(manifest_id,red_msg)', 'event JointRoles(manifest_id,red_msg,def_msg)']),
    ]:
        check_false(positive, query, tokens)
    for name, secret in [('leak-red', 'red_msg'), ('leak-defense', 'def_msg')]:
        check_false(outputs[name], f'not attacker({secret}[])', ['The attacker has the message', f'= {secret}.'])
    # Capture query variable spelling from actual output; it is printer-generated.
    for event in ['GateBRelease', 'DefenseLearnsRed']:
        out = outputs['early-release']
        query = next(s.removeprefix('RESULT ').removesuffix(' is false.') for s in out.splitlines() if s.startswith('RESULT event(' + event) and '==> event(AttackManifestSealed(' in s)
        trace = check_false(out, query, [f'event {event}(manifest_id,red_msg)'])
        assert 'event AttackManifestSealed(' not in trace, 'early-release witness already sealed'
    out = outputs['unauthenticated-receiver']
    query = next(s.removeprefix('RESULT ').removesuffix(' is false.') for s in out.splitlines() if s.startswith('RESULT inj-event('))
    trace = check_false(out, query, ['event DefenseLearnsRed(manifest_id,def_msg)'])
    assert 'event LeadEmitsToDefense(manifest_id,def_msg)' not in trace
    print('PASS: six security queries; four concrete participation traces; red/defense leaks; early release; unauthenticated receiver.')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--proverif', default='proverif')
    args = parser.parse_args()
    source = (ROOT / 'proofs/coordination/isolation.pv').read_text()
    assert source == (WHITE / 'probes/repaired.pv').read_text(), 'archived repair drift'
    transforms = {
        'leak-red': ('event RedWrites(red_msg);', 'event RedWrites(red_msg);\n  out(daemon, red_msg);'),
        'leak-defense': ('event DefenseWrites(def_msg);', 'event DefenseWrites(def_msg);\n  out(daemon, def_msg);'),
        'early-release': ('    in(daemon, (=mid, seal_sig: bitstring));\n    if verify(seal_sig, seal_statement(mid, ct), sk_red_pub) = true then\n', ''),
        'unauthenticated-receiver': ('  if verify(gate_sig, gate_ct, sk_lead_pub) = true then\n', ''),
    }
    for name, (old, new) in transforms.items():
        assert source.count(old) == 1, ('ambiguous mutation', name)
        assert source.replace(old, new) == (WHITE / 'probes' / f'{name}.pv').read_text(), ('mutant drift', name)
    outputs = {}
    for name in ['repaired', *transforms]:
        proc = subprocess.run([args.proverif, str(WHITE / 'probes' / f'{name}.pv')], capture_output=True, text=True, timeout=60, check=True)
        assert not proc.stderr, (name, proc.stderr)
        outputs[name] = proc.stdout
    baseline = (ROOT / 'proofs/coordination/isolation.run.log').read_text()
    extract = lambda text: [line for line in text.splitlines() if line.startswith('RESULT ')]
    assert extract(outputs['repaired']) == extract(baseline), 'canonical RESULT drift'
    verify(outputs)

if __name__ == '__main__':
    main()
