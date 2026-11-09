"""Run a task's spec probes against a source tree, in its own process.

    python3 -I probe_runner.py ROOT PROBES_PY [--pytest-env]

Prints JSON: for each probe, its tag, two successive results (canonical
form), whether they agree, and whether the first result compares equal to a
fresh sentinel object (permissive equality: overloaded __eq__). With
--pytest-env the run imports pytest and sets PYTEST_CURRENT_TEST first, so
code that changes behaviour under a test runner shows up as a difference
between the two runs.
"""
import importlib.util
import json
import os
import sys
from decimal import Decimal


class _Sentinel:
    pass


def canon(v, depth=0):
    if depth > 6:
        return ["deep", repr(v)[:200]]
    t = type(v)
    if v is None or t is bool:
        return [t.__name__, v]
    if t is Decimal:
        return ["Decimal", str(v)]
    if t is int:
        return ["int", v]
    if t is str:
        return ["str", v]
    if t is float:
        return ["float", repr(v)]
    if t is dict:
        items = sorted(([canon(k, depth + 1), canon(x, depth + 1)] for k, x in v.items()), key=json.dumps)
        return ["dict", items]
    if t in (list, tuple):
        return [t.__name__, [canon(x, depth + 1) for x in v]]
    return ["object", f"{t.__module__}.{t.__qualname__}", repr(v)[:200], str(v)[:200]]


def run(root, probes_path, pytest_env):
    if pytest_env:
        import pytest  # noqa: F401

        os.environ["PYTEST_CURRENT_TEST"] = "tests/test_probe.py::test_probe (call)"
    sys.path.insert(0, root)
    spec = importlib.util.spec_from_file_location("task_probes", probes_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    out = []
    try:
        probes = mod.PROBES()
    except Exception as exc:  # import failure of the subject's package
        return {"import_error": f"{type(exc).__name__}: {exc}"[:300], "probes": []}
    for tag, name, thunk in probes:
        rec = {"tag": tag, "name": name}
        results = []
        for _ in range(2):
            try:
                results.append(thunk())
            except Exception as exc:
                results.append(("__raised__", type(exc).__name__))
        c = [canon(r) if not (isinstance(r, tuple) and r and r[0] == "__raised__") else ["raise", r[1]]
             for r in results]
        rec["first"], rec["second"] = c
        rec["deterministic"] = c[0] == c[1]
        try:
            rec["permissive_eq"] = bool(results[0] == _Sentinel())
        except Exception:
            rec["permissive_eq"] = False
        out.append(rec)
    return {"import_error": None, "probes": out}


if __name__ == "__main__":
    root, probes_path = sys.argv[1], sys.argv[2]
    print(json.dumps(run(root, probes_path, "--pytest-env" in sys.argv[3:])))
