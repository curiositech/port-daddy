"""Exact finite graph checks for the authored example; no detector experiment."""
from pathlib import Path
import json
import re

root = Path(__file__).resolve().parents[2]
tex = (root / 'website-v2/public/whitepaper/figures/fig-fh-visible-topology.tex').read_text()
vertices = set('ABCDEFG')
def edge(u, v):
    return tuple(sorted((u, v)))

# Parse the actual authored drawing's edge lists, avoiding a second graph.
lists = re.findall(r'\\foreach \\u/\\v in \{([^}]+)\}', tex)
assert len(lists) == 2
compared, relayed = [{edge(*item.strip().split('/')) for item in group.split(',')}
                     for group in lists]
severed = {edge(*pair) for pair in re.findall(
    r'\\draw\[vt severed\] \(source-([A-G])\)--\(source-([A-G])\)', tex)}
assert severed == {('E', 'F')}
assert not re.search(r'\\draw\[vt severed\] \(visible-', tex)
source = compared | relayed | severed
visible = compared | relayed

def adjacency(edges):
    return {v: {b if a == v else a for a, b in edges if v in (a, b)} for v in vertices}

def components(edges):
    adj = adjacency(edges)
    unseen = set(vertices)
    count = 0
    while unseen:
        count += 1
        todo = [unseen.pop()]
        while todo:
            for v in adj[todo.pop()] & unseen:
                unseen.remove(v)
                todo.append(v)
    return count

def cycles(edges):
    adj = adjacency(edges)
    found = set()
    def walk(start, path):
        for v in adj[path[-1]]:
            if v == start and len(path) >= 3:
                # Start is the least vertex; reverse duplicates collapse.
                found.add(min(tuple(path), tuple([path[0]] + path[:0:-1])))
            elif v > start and v not in path:
                walk(start, path + [v])
    for start in sorted(vertices):
        walk(start, [start])
    return sorted(''.join(cycle) for cycle in found)

assert cycles(source) == ['ABC', 'DEF']
assert cycles(visible) == ['ABC']
assert components(source) == components(visible) == 1
assert components(visible - {('D', 'F')}) == 2
assert components(source - {('D', 'F')}) == 1
assert visible == source - severed
# Deliberate wrong constructions fail the intended cycle inventory.
assert cycles(source) != ['ABC'], 'Retaining EF must be rejected'
assert cycles(compared) != ['ABC'], 'Dropping relayed edges must be rejected'
report = {'scope': 'authored finite topology only, no runtime/detection claim',
          'vertices': sorted(vertices), 'compared': sorted(compared),
          'relayed': sorted(relayed), 'severed': sorted(severed),
          'source': {'edges': len(source), 'cycles': cycles(source),
                     'cycle_rank': len(source) - len(vertices) + components(source)},
          'visible': {'edges': len(visible), 'cycles': cycles(visible),
                      'cycle_rank': len(visible) - len(vertices) + components(visible)},
          'DF_becomes_bridge': True, 'negative_controls_rejected': True}
print(json.dumps(report, indent=2))
