#!/usr/bin/env python3
"""Excerpt a TLC run log for an "At the terminal" session.

Prints the block from the first ``Error: Invariant`` line to the state-count
summary, keeping only the states named in ``--keep-states`` (an elision line
marks what was cut), and strips wall-clock stamps and the trace-exploration
path so the excerpt is stable across runs. Usage:

    excerpt_trace.py RUN.log [--keep-states 1,2,3,6]
"""
import argparse
import re
import sys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("log")
    ap.add_argument("--keep-states", default="", help="comma-separated state numbers to print; default all")
    a = ap.parse_args()
    keep = {int(x) for x in a.keep_states.split(",") if x.strip()}
    with open(a.log, encoding="utf-8", errors="replace") as fh:
        lines = fh.read().splitlines()
    start = next((i for i, l in enumerate(lines) if l.startswith("Error: Invariant")), None)
    if start is None:
        print("no invariant violation in log", file=sys.stderr)
        return 1
    out, state, elided = [], None, []
    for l in lines[start:]:
        if l.startswith("Trace exploration spec path"):
            continue
        l = re.sub(r"\s+at \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\)", "", l)
        m = re.match(r"State (\d+): <(\w+)(?:\(([^)]*)\))? line \d+, col \d+ to line \d+, col \d+ of module (\w+)>", l)
        if m:
            state = int(m.group(1))
            if keep and state not in keep:
                elided.append(state)
                continue
            act = m.group(2) + (f"({m.group(3)})" if m.group(3) else "")
            l = f"State {state}: <{act}>"
        elif re.match(r"State (\d+): <Initial predicate>", l):
            state = int(re.match(r"State (\d+)", l).group(1))
            if keep and state not in keep:
                elided.append(state)
                continue
        if state is not None and keep and state not in keep:
            continue
        if elided and (m or re.match(r"^\d+ states generated", l)):
            span = f"{elided[0]}" if len(elided) == 1 else f"{elided[0]}-{elided[-1]}"
            out.append(f"  ... state{'s' if len(elided) > 1 else ''} {span} elided ...")
            out.append("")
            elided = []
        out.append(l.rstrip())
    print("\n".join(out).rstrip())
    return 0


if __name__ == "__main__":
    sys.exit(main())
