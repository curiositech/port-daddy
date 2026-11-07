#!/usr/bin/env python3
"""Replay the finite AdmissionRevision TLC model and three concrete controls.

All tool outputs, generated traces, copied inputs and a hash-bound receipt stay
in a fresh directory under this checkout's .cache/admission-revision. This is
finite model checking, not a general theorem or production enforcement proof.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / 'docs/harbor-research/campaigns/2026-11-06/models'
CASES = {'bound': ('TRUE', 'SafeAdmission'),
         'unbound': ('FALSE', 'SafeAdmission'),
         'accepted': ('TRUE', 'NoAdmission'),
         'stale_rejected': ('TRUE', 'NoStaleRejection')}
INITIAL = dict(revision=0, conflict=False, checkedRevision=-1, certificate=False,
               admitted=False, badAdmission=False, rejected=False)
CHECKED = dict(INITIAL, checkedRevision=0, certificate=True)
STALE = dict(CHECKED, revision=1, conflict=True)
EXPECTED = {
    'unbound': [('Initial predicate', INITIAL), ('Check', CHECKED),
                ('ChangeModel', STALE),
                ('Admit', dict(STALE, admitted=True, badAdmission=True))],
    'accepted': [('Initial predicate', INITIAL), ('Check', CHECKED),
                 ('Admit', dict(CHECKED, admitted=True))],
    'stale_rejected': [('Initial predicate', INITIAL), ('Check', CHECKED),
                       ('ChangeModel', STALE),
                       ('RejectStale', dict(STALE, rejected=True))],
}


class GateError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise GateError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def parse_trace(output):
    headers = list(re.finditer(r'^State (\d+): <([^>]+)>\s*$', output, re.M))
    trace = []
    for i, header in enumerate(headers):
        require(int(header[1]) == i + 1, 'nonconsecutive trace states')
        end = headers[i + 1].start() if i + 1 < len(headers) else len(output)
        body = output[header.end():end]
        assignments = re.findall(r'^/\\ (\w+) = (TRUE|FALSE|-?\d+)\s*$', body, re.M)
        state = {name: value == 'TRUE' if value in ('TRUE', 'FALSE') else int(value)
                 for name, value in assignments}
        require(len(assignments) == len(INITIAL) and set(state) == set(INITIAL),
                'missing, duplicate or unsupported trace assignment')
        require(all(type(state[name]) is type(value) for name, value in INITIAL.items()),
                'trace assignment has wrong type')
        action = header[2].split(' line ', 1)[0]
        trace.append((action, state))
    return trace


def validate_output(case, returncode, output):
    """Fail closed on tool failures, wrong invariants, and wrong/missing witnesses."""
    require(case in CASES, 'unknown case')
    matches = re.findall(r'([\d,]+) states generated, ([\d,]+) distinct states found, '
                         r'([\d,]+) states left on queue\.', output)
    require(len(matches) == 1, f'{case}: missing/duplicate exploration summary')
    generated, distinct, queued = (int(x.replace(',', '')) for x in matches[0])
    require(generated >= distinct > 0 and queued >= 0, f'{case}: invalid counts')
    errors = re.findall(r'^Error: (.*)$', output, re.M)
    trace = parse_trace(output)
    if case == 'bound':
        require(returncode == 0 and not errors, 'bound: TLC failed')
        require('Model checking completed. No error has been found.' in output,
                'bound: no completed safety verdict')
        require(distinct == 12 and queued == 0 and not trace,
                'bound: expected complete 12-state model with no counterexample')
    else:
        expected_error = f'Invariant {CASES[case][1]} is violated.'
        require(returncode == 12, f'{case}: expected TLC invariant exit 12, got {returncode}')
        require(errors == [expected_error, 'The behavior up to this point is:'],
                f'{case}: wrong TLC error(s): {errors}')
        require('No error has been found' not in output, f'{case}: contradictory verdict')
        require(trace == EXPECTED[case], f'{case}: wrong concrete counterexample: {trace}')
    return dict(case=case, exit_code=returncode, generated_states=generated,
                distinct_states=distinct, queued_states=queued,
                trace=[dict(action=action, state=state) for action, state in trace],
                verdict='safe' if case == 'bound' else 'expected concrete counterexample')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', default='java')
    parser.add_argument('--jar', default=os.environ.get('TLA_TOOLS_JAR'))
    parser.add_argument('--timeout', type=int, default=60, help='seconds per configuration')
    args = parser.parse_args()
    if not args.jar or args.timeout <= 0:
        parser.error('--jar (or TLA_TOOLS_JAR) and a positive --timeout are required')
    jar = Path(args.jar).expanduser().resolve(strict=True)
    java = shutil.which(args.java)
    if java is None:
        parser.error('Java executable not found')
    cache = ROOT / '.cache/admission-revision'
    require(cache.resolve().is_relative_to(ROOT), 'cache escapes checkout')
    cache.mkdir(parents=True, exist_ok=True)
    run_dir = Path(tempfile.mkdtemp(prefix='run-', dir=cache))
    receipt = dict(evidence_class='finite TLC model checking', status='running',
                   java=java, jar=str(jar), jar_sha256=sha256(jar.read_bytes()),
                   timeout_seconds=args.timeout, inputs={}, cases=[])
    status = 1
    try:
        # Snapshot every input once, before running any configuration.
        inputs = {name: (MODELS / name).read_bytes()
                  for name in ['AdmissionRevision.tla', *(x + '.cfg' for x in CASES)]}
        for name, data in inputs.items():
            receipt['inputs'][name] = sha256(data)
        for case, (bound, invariant) in CASES.items():
            expected_cfg = (f'SPECIFICATION Spec CONSTANT BindRevision = {bound} '
                            f'INVARIANTS TypeOK {invariant} CHECK_DEADLOCK FALSE')
            require(' '.join(inputs[case + '.cfg'].decode().split()) == expected_cfg,
                    f'{case}: configuration drift')
            directory = run_dir / case
            directory.mkdir()
            for name in ('AdmissionRevision.tla', case + '.cfg'):
                (directory / name).write_bytes(inputs[name])
            command = [java, '-XX:+UseParallelGC', '-cp', str(jar), 'tlc2.TLC',
                       '-workers', '1', '-config', case + '.cfg', 'AdmissionRevision.tla']
            with (directory / 'stdout.log').open('w') as stdout, \
                    (directory / 'stderr.log').open('w') as stderr:
                proc = subprocess.run(command, cwd=directory, stdout=stdout, stderr=stderr,
                                      text=True, timeout=args.timeout, check=False)
            output = (directory / 'stdout.log').read_text()
            error_output = (directory / 'stderr.log').read_text()
            require(not error_output.strip(), f'{case}: unexpected stderr; see {directory}')
            result = validate_output(case, proc.returncode, output)
            result.update(command=command, stdout_sha256=sha256(output.encode()))
            receipt['cases'].append(result)
            print(f"PASS {case}: {result['verdict']}; {result['distinct_states']} distinct "
                  f"states; {len(result['trace'])} witness states", flush=True)
        receipt['status'], status = 'passed', 0
    except (GateError, OSError, subprocess.TimeoutExpired) as error:
        receipt['status'], receipt['error'] = 'failed', str(error)
        print(f'FAIL: {error}', file=sys.stderr)
    finally:
        (run_dir / 'summary.json').write_text(json.dumps(receipt, indent=2) + '\n')
        print(f'Evidence: {run_dir}', flush=True)
    return status


if __name__ == '__main__':
    raise SystemExit(main())
