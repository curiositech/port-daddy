#!/usr/bin/env python3
"""Replay the bounded atomic-admission model and exact adversarial witnesses.

The script records model/config/tool hashes and full TLC output in this linked
checkout's .cache. It proves neither unbounded safety nor code refinement.
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
MODEL = ROOT / 'docs/harbor-research/campaigns/2026-11-06/round-two/white/AtomicAdmission.tla'
INITIAL = dict(token=0, revision=0, rowExists=True, content=0, policy=0, model=0,
               epoch=0, decision=0, complete=False, operation=0,
               checkedRevision=-1, checkedPolicy=-1, checkedModel=-1,
               checkedEpoch=-1, checkedOperation=-1, validated=False, writes=0,
               deleted=False, recreated=False, effectCount=0, badEffect=False,
               rejected=False)
# Each witness is a fixed preregistered scenario, not an arbitrary TLC failure.
# Scenario 0 is the full finite safety exploration. Fault 0 is the defended gate.
SCENARIOS = {
    'accepted': (1, []),
    'stale': (2, ['Write']),
    'aba': (3, ['Write', 'Write']),
    'recreated': (4, ['Delete', 'Recreate']),
    'policy': (5, ['PolicyChange']),
    'model': (6, ['ModelChange']),
    'authority_epoch': (7, ['PolicyChange', 'RestorePolicy']),
    'race': (8, ['Validate', 'Write']),
    'unsafe': (9, []),
    'unknown': (10, []),
    'replay': (11, ['Commit']),
    'request': (12, ['SubstituteRequest']),
    'incomplete': (13, []),
    'rollback_provenance': (14, ['Write', 'Write']),
    'no_op_replay': (15, ['Commit']),
}
CASES = {'bound': (0, 0, 'SafeAdmission', [])}
for label, (scenario, steps) in SCENARIOS.items():
    suffix = 'Commit' if label == 'accepted' else 'RejectReplay' if label in ('replay', 'no_op_replay') else 'Reject'
    invariant = 'NoAdmission' if label == 'accepted' else 'NoRejection'
    CASES[label] = (scenario, 0, invariant, ['Issue', *steps, suffix])
for label, fault in [('stale', 1), ('aba', 1), ('recreated', 1), ('policy', 2),
                     ('model', 2), ('authority_epoch', 2), ('race', 3),
                     ('unsafe', 4), ('unknown', 4), ('incomplete', 4),
                     ('request', 5), ('stale', 6), ('aba', 6), ('recreated', 6)]:
    scenario, steps = SCENARIOS[label]
    name = f'mutant_{label}' if fault != 6 else f'mutant_clock_{label}'
    CASES[name] = (scenario, fault, 'SafeAdmission', ['Issue', *steps, 'Commit'])
CASES['mutant_refreshed_rollback'] = (14, 7, 'SafeAdmission',
    ['Issue', 'Write', 'Write', 'RefreshStaleRollback', 'Commit'])


class GateError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise GateError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def expected_trace(case):
    """Independent concrete state oracle for each fixed control sequence."""
    scenario, fault, _, actions = CASES[case]
    state = dict(INITIAL)
    trace = [('Initial predicate', dict(state))]
    for action in actions:
        if action == 'Issue':
            state.update(token=1, decision=2 if scenario == 9 else 3 if scenario == 10 else 1,
                         complete=scenario != 13, checkedRevision=state['revision'],
                         checkedPolicy=state['policy'], checkedModel=state['model'],
                         checkedEpoch=state['epoch'], checkedOperation=state['operation'])
        elif action in ('Write', 'Delete', 'Recreate'):
            state['writes'] += 1
            if fault != 6:
                state['revision'] += 1
            if action == 'Write':
                state['content'] = 1 - state['content']
            elif action == 'Delete':
                state.update(rowExists=False, deleted=True)
            else:
                state.update(rowExists=True, recreated=True)
        elif action in ('PolicyChange', 'ModelChange', 'RestorePolicy'):
            state['epoch'] += 1
            if action == 'PolicyChange':
                state['policy'] = 1
            if action == 'ModelChange':
                state['model'] = 1
            if action == 'RestorePolicy':
                state['policy'] = 0
        elif action == 'Validate':
            state['validated'] = True
        elif action == 'SubstituteRequest':
            state['operation'] = 1
        elif action == 'RefreshStaleRollback':
            state['checkedRevision'] = state['revision']
        elif action == 'Commit':
            # Exact freshness is intentionally stronger than checking whether
            # the new state happens to remain safe under the supplied policy.
            correct = (state['token'] == 1 and state['rowExists'] and state['writes'] == 0
                       and state['decision'] == 1 and state['complete']
                       and all(state[current] == state[checked] for current, checked in [
                           ('revision', 'checkedRevision'), ('policy', 'checkedPolicy'),
                           ('model', 'checkedModel'), ('epoch', 'checkedEpoch'),
                           ('operation', 'checkedOperation')]))
            state.update(token=2, effectCount=state['effectCount'] + 1,
                         revision=state['revision'] + (scenario != 15),
                         badEffect=state['badEffect'] or not correct)
        elif action in ('Reject', 'RejectReplay'):
            state.update(token=2, rejected=True)
        else:
            raise GateError(f'unsupported oracle action {action}')
        trace.append((action, dict(state)))
    return trace


def parse_trace(output):
    headers = list(re.finditer(r'^State (\d+): <([^>]+)>\s*$', output, re.M))
    trace = []
    for index, header in enumerate(headers):
        require(int(header[1]) == index + 1, 'nonconsecutive trace states')
        end = headers[index + 1].start() if index + 1 < len(headers) else len(output)
        body = output[header.end():end]
        assignments = re.findall(r'^/\\ (\w+) = (TRUE|FALSE|-?\d+)\s*$', body, re.M)
        state = {name: value == 'TRUE' if value in ('TRUE', 'FALSE') else int(value)
                 for name, value in assignments}
        require(len(assignments) == len(INITIAL) and set(state) == set(INITIAL),
                'missing, duplicate or unsupported trace assignment')
        require(all(type(state[name]) is type(value) for name, value in INITIAL.items()),
                'trace assignment has wrong type')
        trace.append((header[2].split(' line ', 1)[0], state))
    return trace


def validate_output(case, returncode, output, stderr=''):
    require(case in CASES, 'unknown case')
    require(not stderr.strip(), f'{case}: unexpected stderr')
    summaries = re.findall(r'([\d,]+) states generated, ([\d,]+) distinct states found, '
                           r'([\d,]+) states left on queue\.', output)
    require(len(summaries) == 1, f'{case}: missing/duplicate exploration summary')
    generated, distinct, queued = (int(value.replace(',', '')) for value in summaries[0])
    require(generated >= distinct > 0 and queued >= 0, f'{case}: invalid state counts')
    errors = re.findall(r'^Error: (.*)$', output, re.M)
    trace = parse_trace(output)
    if case == 'bound':
        require(returncode == 0 and not errors, 'bound: TLC failed')
        require('Model checking completed. No error has been found.' in output,
                'bound: no completed safety verdict')
        require(distinct == 602 and queued == 0 and not trace,
                'bound: expected complete 602-state model with no counterexample')
    else:
        require(returncode == 12, f'{case}: expected invariant exit 12, got {returncode}')
        require(errors == [f'Invariant {CASES[case][2]} is violated.',
                           'The behavior up to this point is:'], f'{case}: wrong TLC errors')
        require('No error has been found' not in output, f'{case}: contradictory verdict')
        require(trace == expected_trace(case), f'{case}: wrong concrete witness')
    return dict(case=case, exit_code=returncode, generated_states=generated,
                distinct_states=distinct, queued_states=queued,
                verdict='finite safety pass' if case == 'bound' else 'expected exact witness',
                trace=[dict(action=action, state=state) for action, state in trace])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', default='java')
    parser.add_argument('--jar', default=os.environ.get('TLA_TOOLS_JAR'))
    parser.add_argument('--timeout', type=int, default=30)
    args = parser.parse_args()
    if not args.jar or args.timeout <= 0:
        parser.error('--jar and a positive --timeout are required')
    jar = Path(args.jar).expanduser().resolve(strict=True)
    java = shutil.which(args.java)
    if not java:
        parser.error('Java executable not found')
    cache = ROOT / '.cache/atomic-admission'
    require(cache.resolve().is_relative_to(ROOT), 'cache escapes checkout')
    cache.mkdir(parents=True, exist_ok=True)
    run_dir = Path(tempfile.mkdtemp(prefix='run-', dir=cache))
    model = MODEL.read_bytes()
    script = Path(__file__).read_bytes()
    receipt = dict(status='running', evidence_class='finite TLC model checking',
                   java=java, java_sha256=sha256(Path(java).read_bytes()),
                   jar=str(jar), jar_sha256=sha256(jar.read_bytes()),
                   model_sha256=sha256(model), checker_sha256=sha256(script),
                   timeout_seconds=args.timeout, cases=[])
    status = 1
    try:
        (run_dir / MODEL.name).write_bytes(model)
        (run_dir / Path(__file__).name).write_bytes(script)
        for case, (scenario, fault, invariant, _) in CASES.items():
            directory = run_dir / case
            directory.mkdir()
            temporary = directory / 'tmp'
            temporary.mkdir()
            (directory / MODEL.name).write_bytes(model)
            config = (f'SPECIFICATION Spec\nCONSTANTS Scenario = {scenario} Fault = {fault}\n'
                      f'INVARIANTS TypeOK {invariant}\nCHECK_DEADLOCK FALSE\n')
            (directory / 'case.cfg').write_text(config)
            command = [java, f'-Djava.io.tmpdir={temporary}', '-XX:+UseParallelGC',
                       '-Xmx512m', '-cp', str(jar), 'tlc2.TLC', '-workers', '1',
                       '-config', 'case.cfg', MODEL.name]
            with (directory / 'stdout.log').open('w') as stdout, \
                    (directory / 'stderr.log').open('w') as stderr:
                process = subprocess.run(command, cwd=directory, stdout=stdout, stderr=stderr,
                                         text=True, timeout=args.timeout, check=False)
            output = (directory / 'stdout.log').read_text()
            error = (directory / 'stderr.log').read_text()
            result = validate_output(case, process.returncode, output, error)
            result.update(command=command, config_sha256=sha256(config.encode()),
                          stdout_sha256=sha256(output.encode()), stderr_sha256=sha256(error.encode()))
            receipt['cases'].append(result)
            print(f"PASS {case}: {result['distinct_states']} distinct states; "
                  f"{len(result['trace'])} witness states", flush=True)
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
