#!/usr/bin/env python3
"""Exact finite checks of the scout's D25 binary edge/vertex error distinction.

Constructed GF(2) examples, not production evidence, signed-protocol forensics,
or a general decoding algorithm. A corrupt vertex may flip any incident edges.
"""
from itertools import combinations, product
import json


def cut_word(potential, edges):
    return tuple(potential[a] ^ potential[b] for a, b in edges)


def cycle_checks(n, edges):
    """Build a spanning tree and its fundamental-cycle parity checks."""
    neighbors = [[] for _ in range(n)]
    for index, (a, b) in enumerate(edges):
        neighbors[a].append((b, index))
        neighbors[b].append((a, index))
    parent, paths, todo = {0: None}, {0: set()}, [0]
    for a in todo:
        for b, edge in neighbors[a]:
            if b not in parent:
                parent[b] = edge
                paths[b] = paths[a] | {edge}
                todo.append(b)
    if len(parent) != n:
        return None
    tree = set(parent.values()) - {None}
    return tuple(paths[a] ^ paths[b] ^ {index}
                 for index, (a, b) in enumerate(edges) if index not in tree)


def syndrome(word, checks):
    return tuple(sum(word[i] for i in check) % 2 for check in checks)


def xor(a, b):
    return tuple(x ^ y for x, y in zip(a, b))


def check_small_graphs():
    graphs = stars = received = 0
    for n in range(2, 5):
        possible = tuple(combinations(range(n), 2))
        for include in product((0, 1), repeat=len(possible)):
            edges = tuple(edge for edge, present in zip(possible, include) if present)
            checks = cycle_checks(n, edges)
            if checks is None:
                continue
            code = {cut_word(p, edges) for p in product((0, 1), repeat=n)}
            assert len(code) == 2 ** (n - 1)
            for word in product((0, 1), repeat=len(edges)):
                assert (not any(syndrome(word, checks))) == (word in code)
                received += 1
            for vertex in range(n):
                star = tuple(int(vertex in edge) for edge in edges)
                assert any(star) and not any(syndrome(star, checks))
                stars += 1
            graphs += 1
    return dict(connected_graphs=graphs, received_words=received,
                undetectable_single_vertex_stars=stars)


def check_k4():
    n, edges = 4, tuple(combinations(range(4), 2))
    checks = cycle_checks(n, edges)
    code = {cut_word(p, edges) for p in product((0, 1), repeat=n)}
    distance = min(sum(word) for word in code if any(word))
    assert distance == 3
    edge_errors = [(0,) * len(edges)] + [tuple(int(i == j) for i in range(len(edges)))
                                        for j in range(len(edges))]
    balls = [{xor(c, error) for error in edge_errors} for c in code]
    assert len(set().union(*balls)) == sum(map(len, balls)) == 56
    # One vertex changes zero to a different valid codeword: no syndrome.
    star = tuple(int(0 in edge) for edge in edges)
    assert star == (1, 1, 1, 0, 0, 0) and star in code
    assert syndrome(star, checks) == (0, 0, 0)
    # Pinning one global potential (vertex 0) still leaves vertex 1's star.
    pinned = {cut_word((0,) + p, edges) for p in product((0, 1), repeat=3)}
    assert tuple(int(1 in edge) for edge in edges) in pinned
    # Negative control: deleting a parity check hides a single edge error.
    hidden = next(error for error in edge_errors if any(syndrome(error, checks))
                  and not any(syndrome(error, checks[1:])))
    # Nearest cut to all ones equals m minus MAX-CUT, not minimum cut.
    all_ones = (1,) * len(edges)
    residual = min(sum(xor(all_ones, c)) for c in code)
    maximum_cut = max(map(sum, code))
    assert (maximum_cut, residual) == (4, 2)
    return dict(edges=edges, cut_codewords=len(code), edge_distance=distance,
                single_edge_correctable_words=56, vertex_distance=1,
                undetectable_star=star, star_syndrome=syndrome(star, checks),
                deleted_check_hidden_edge=hidden, max_cut=maximum_cut,
                all_ones_nearest_residual=residual)


if __name__ == '__main__':
    print(json.dumps({'small_graphs': check_small_graphs(), 'K4': check_k4()}, indent=2))
