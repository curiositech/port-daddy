#!/usr/bin/env python3
"""Exact, synthetic typed cellular-sheaf 2-complex fixture.

Coordinates are rational *fixture values*: completion count and validated
handoff count. Their names do not establish artifact provenance, semantic
correctness, failure attribution, or field performance. All inner products
below are the explicitly chosen standard coordinate inner products.
"""

from __future__ import annotations

import argparse
from fractions import Fraction
from itertools import combinations
import json

F = Fraction
Matrix = tuple[tuple[Fraction, ...], ...]
Vector = tuple[Fraction, ...]
VERTICES = (0, 1, 2, 3)
EDGE_ORDER = ("01:count", "12:count", "02:count", "02:handoff", "23:handoff", "03:handoff")
EDGE_GROUPS = ((0,), (1,), (2, 3), (4,), (5,))


def matrix(rows) -> Matrix:
    return tuple(tuple(F(value) for value in row) for row in rows)


def transpose(a: Matrix) -> Matrix:
    return tuple(zip(*a)) if a else ()


def matvec(a: Matrix, x: Vector) -> Vector:
    return tuple(sum((v * w for v, w in zip(row, x, strict=True)), F(0)) for row in a)


def dot(x: Vector, y: Vector) -> Fraction:
    return sum((a * b for a, b in zip(x, y, strict=True)), F(0))


def add(x: Vector, y: Vector) -> Vector:
    return tuple(a + b for a, b in zip(x, y, strict=True))


def sub(x: Vector, y: Vector) -> Vector:
    return tuple(a - b for a, b in zip(x, y, strict=True))


def rref(a: Matrix, width: int | None = None) -> tuple[Matrix, tuple[int, ...]]:
    width = len(a[0]) if a else (0 if width is None else width)
    if any(len(row) != width for row in a):
        raise ValueError("ragged matrix")
    rows = [list(row) for row in a]
    pivots = []
    lead = 0
    for col in range(width):
        candidate = next((i for i in range(lead, len(rows)) if rows[i][col]), None)
        if candidate is None:
            continue
        rows[lead], rows[candidate] = rows[candidate], rows[lead]
        pivot = rows[lead][col]
        rows[lead] = [value / pivot for value in rows[lead]]
        for i in range(len(rows)):
            if i != lead and rows[i][col]:
                scale = rows[i][col]
                rows[i] = [a - scale * b for a, b in zip(rows[i], rows[lead], strict=True)]
        pivots.append(col)
        lead += 1
        if lead == len(rows):
            break
    return tuple(tuple(row) for row in rows), tuple(pivots)


def rank(a: Matrix, width: int | None = None) -> int:
    return len(rref(a, width)[1])


def nullspace(a: Matrix, width: int) -> tuple[Vector, ...]:
    reduced, pivots = rref(a, width)
    basis = []
    for free in range(width):
        if free in pivots:
            continue
        vector = [F(0)] * width
        vector[free] = F(1)
        for row, pivot in enumerate(pivots):
            vector[pivot] = -reduced[row][free]
        basis.append(tuple(vector))
    return tuple(basis)


def inverse(a: Matrix) -> Matrix:
    n = len(a)
    if any(len(row) != n for row in a):
        raise ValueError("inverse requires square matrix")
    augmented = matrix(tuple(row) + tuple(int(i == j) for j in range(n)) for i, row in enumerate(a))
    reduced, pivots = rref(augmented)
    if pivots[:n] != tuple(range(n)):
        raise ValueError("singular matrix")
    return tuple(row[n:] for row in reduced)


def project_columns(a: Matrix, y: Vector) -> Vector:
    """Exact orthogonal projection to column space of a."""
    if len(a) != len(y):
        raise ValueError("projection dimension mismatch")
    pivots = rref(a)[1]
    if not pivots:
        return (F(0),) * len(y)
    columns = tuple(tuple(row[col] for row in a) for col in pivots)
    gram = matrix(tuple(dot(left, right) for right in columns) for left in columns)
    coefficients = matvec(inverse(gram), tuple(dot(column, y) for column in columns))
    return tuple(sum((column[i] * coefficient for column, coefficient in zip(columns, coefficients, strict=True)), F(0)) for i in range(len(y)))


def validate_map(value, rows: int, cols: int, label: str) -> Matrix:
    try:
        result = matrix(value)
    except (TypeError, ValueError, ZeroDivisionError) as error:
        raise ValueError(f"malformed restriction {label}") from error
    if len(result) != rows or any(len(row) != cols for row in result):
        raise ValueError(f"malformed restriction {label}: expected {rows}x{cols}")
    return result


def build_complex(
    add_handoff_face: bool = False,
    restriction_overrides: dict[tuple[str, str], object] | None = None,
) -> tuple[Matrix, Matrix]:
    """Return d0: C0→C1 and d1: C1→C2 in the stated cell order.

    Each edge declares source and target stalk restrictions. Face restrictions
    are 01↦count, 12↦count, 02↦count for 012; and 02↦handoff,
    23↦handoff, 03↦handoff for 023. Orientation is 01+12−02
    and 02+23−03, respectively.
    """
    count = ((1, 0),)
    handoff = ((0, 1),)
    identity = ((1, 0), (0, 1))
    specs = (("01", 0, 1, count, count), ("12", 1, 2, count, count),
             ("02", 0, 2, identity, identity), ("23", 2, 3, handoff, handoff),
             ("03", 0, 3, handoff, handoff))
    overrides = restriction_overrides or {}
    valid_keys = {(edge, side) for edge, *_ in specs for side in ("source", "target")}
    if set(overrides) - valid_keys:
        raise ValueError("unknown restriction override")
    a_rows = []
    for edge, source, target, source_map, target_map in specs:
        edge_dim = len(source_map)
        source_map = validate_map(overrides.get((edge, "source"), source_map), edge_dim, 2, edge + ":source")
        target_map = validate_map(overrides.get((edge, "target"), target_map), edge_dim, 2, edge + ":target")
        for source_row, target_row in zip(source_map, target_map, strict=True):
            row = [F(0)] * 8
            for coordinate in range(2):
                row[2 * source + coordinate] -= source_row[coordinate]
                row[2 * target + coordinate] += target_row[coordinate]
            a_rows.append(tuple(row))
    a = matrix(a_rows)
    # Face restrictions, listed as (edge, orientation, map to the R face stalk).
    # Identity maps on one-coordinate edges are (1,); 02 uses a projection.
    edge_spans = {"01": (0,), "12": (1,), "02": (2, 3), "23": (4,), "03": (5,)}
    face_terms = (
        (("01", 1, (1,)), ("12", 1, (1,)), ("02", -1, (1, 0))),
        (("02", 1, (0, 1)), ("23", 1, (1,)), ("03", -1, (1,))),
    )
    b_rows = []
    for face in face_terms[:2 if add_handoff_face else 1]:
        row = [F(0)] * len(a)
        for edge, orientation, restriction in face:
            for coordinate, coefficient in zip(edge_spans[edge], restriction, strict=True):
                row[coordinate] += F(orientation * coefficient)
        b_rows.append(row)
    b = matrix(b_rows)
    if any(matvec(b, tuple(row[col] for row in a)) != (F(0),) * len(b) for col in range(8)):
        raise ValueError("restrictions violate d1 d0 = 0")
    return a, b


def hodge(a: Matrix, b: Matrix, y: Vector) -> dict[str, Vector | Fraction]:
    gradient = project_columns(a, y)
    coexact = project_columns(transpose(b), y)
    harmonic = sub(sub(y, gradient), coexact)
    if dot(gradient, coexact) or dot(gradient, harmonic) or dot(coexact, harmonic):
        raise AssertionError("Hodge summands not orthogonal")
    return {"gradient": gradient, "coexact": coexact, "harmonic": harmonic,
            "compatibility_residual": sub(y, gradient),
            "gradient_norm_squared": dot(gradient, gradient),
            "coexact_norm_squared": dot(coexact, coexact),
            "harmonic_norm_squared": dot(harmonic, harmonic),
            "residual_norm_squared": dot(sub(y, gradient), sub(y, gradient))}


def sheaf_code_distance(a: Matrix) -> tuple[int, tuple[int, ...], Vector, Vector]:
    """Minimum nonzero edge-group support of im(d0), by exact rank search."""
    full_rank = rank(a)
    for size in range(1, len(EDGE_GROUPS) + 1):
        for groups in combinations(range(len(EDGE_GROUPS)), size):
            outside = tuple(i for i in range(len(a)) if all(i not in EDGE_GROUPS[g] for g in groups))
            outside_rows = tuple(a[i] for i in outside)
            if rank(outside_rows, 8) == full_rank:
                continue
            for potential in nullspace(outside_rows, 8):
                image = matvec(a, potential)
                if any(image):
                    return size, groups, potential, image
    raise AssertionError("d0 has zero image")


def relative_coverage(a: Matrix, b: Matrix) -> dict:
    """L has vertices 0,1,2 and count edges 01,12, without a face."""
    visible_columns = (0, 1, 2, 3, 4, 5)
    hidden_columns = (6, 7)
    visible_edges = (0, 1)
    hidden_edges = (2, 3, 4, 5)
    a_l = matrix(tuple(a[i][j] for j in visible_columns) for i in visible_edges)
    a_relative = matrix(tuple(a[i][j] for j in hidden_columns) for i in hidden_edges)
    b_relative = matrix(tuple(row[i] for i in hidden_edges) for row in b)
    # A cocycle on L extends exactly when its connecting class in H1(K,L)
    # vanishes. For this fixture, rank of the image of H0(K) in H0(L)
    # follows by subtracting the kernel supported on hidden vertex 3.
    h0_k = 8 - rank(a)
    h0_l = 6 - rank(a_l)
    restriction_rank = h0_k - (2 - rank(a_relative))
    connecting_rank = h0_l - restriction_rank

    def connecting(values: tuple[int, ...]) -> tuple[Vector, bool]:
        if matvec(a_l, tuple(map(F, values))) != (F(0), F(0)):
            raise ValueError("visible assignment is not a cocycle")
        delta = matvec(matrix(a[i][:6] for i in hidden_edges), tuple(map(F, values)))
        augmented = matrix(tuple(row) + (delta[i],) for i, row in enumerate(a_relative))
        return delta, rank(augmented) > rank(a_relative)

    incompatible, detected = connecting((0, 0, 0, 0, 0, 1))
    equal, equal_detected = connecting((0, 1, 0, 0, 0, 1))
    return {"h0_k": h0_k, "h0_l": h0_l, "restriction_rank": restriction_rank,
            "h1_relative": len(hidden_edges) - rank(a_relative) - rank(b_relative),
            "connecting_rank": connecting_rank,
            "locally_compatible_nonextendible_handoff": incompatible,
            "nonextendible_detected": detected,
            "equal_handoff_extendible": not equal_detected,
            "equal_handoff_connecting_cochain": equal}


def fraction_json(value):
    if isinstance(value, Fraction):
        return str(value)
    if isinstance(value, tuple):
        return [fraction_json(item) for item in value]
    if isinstance(value, dict):
        return {key: fraction_json(item) for key, item in value.items()}
    return value


def study() -> dict:
    a, b = build_complex()
    _, b_filled = build_complex(add_handoff_face=True)
    local = (F(1), F(1), F(-1), F(0), F(0), F(0))
    global_handoff = (F(0), F(0), F(0), F(1), F(1), F(-1))
    gradient = (F(1), F(0), F(1), F(0), F(0), F(0))
    mixed = add(add(local, global_handoff), gradient)
    examples = {"local_count": local, "global_handoff": global_handoff,
                "gradient_alias_difference": gradient, "mixed": mixed}
    cases = {}
    for name, y in examples.items():
        cases[name] = {"observation": y,
                       "base": {**hodge(a, b, y), "face_syndrome": matvec(b, y)},
                       "filled": {**hodge(a, b_filled, y), "face_syndrome": matvec(b_filled, y)}}
    distance, groups, witness_x, witness_y = sheaf_code_distance(a)
    alias_left = (F(1), F(0), F(0), F(0), F(0), F(0))
    alias_right = (F(0), F(0), F(-1), F(0), F(0), F(0))
    alias_vertex_values = (F(-1), F(0), F(0), F(0), F(0), F(0), F(0), F(0))
    assert sub(alias_left, alias_right) == gradient == matvec(a, alias_vertex_values)
    return {"provenance": "synthetic topology and typed feature fixture; no semantic failure attribution or field claims",
            "coordinates": ("completion_count", "validated_handoff_count"),
            "vertex_order": VERTICES, "edge_order": EDGE_ORDER,
            "a_d0": a, "b_d1": b, "b_with_face023": b_filled,
            "base": {"rank_d0": rank(a), "rank_d1": rank(b), "h0": 8 - rank(a),
                     "h1": 6 - rank(a) - rank(b), "h2": len(b) - rank(b)},
            "filled": {"rank_d0": rank(a), "rank_d1": rank(b_filled), "h0": 8 - rank(a),
                       "h1": 6 - rank(a) - rank(b_filled), "h2": len(b_filled) - rank(b_filled)},
            "examples": cases,
            "sheaf_code": {"distance_edge_groups": distance, "witness_groups": groups,
                           "witness_vertex_values": witness_x, "witness_d0": witness_y,
                           "one_edge_alias_left": alias_left, "one_edge_alias_right": alias_right,
                           "alias_difference": sub(alias_left, alias_right),
                           "alias_vertex_values": alias_vertex_values},
            "relative_visible_subcomplex": relative_coverage(a, b)}


def markdown(result: dict) -> str:
    lines = ["# Exact typed cellular-sheaf fixture", "",
             "Synthetic topology and typed feature values only. Zero residual means extendibility",
             "under these restrictions; it does not establish hidden truth or attribute a failure.", "",
             "| Complex | rank d0 | rank d1 | dim H0 | dim H1 | dim H2 |",
             "|---|---:|---:|---:|---:|---:|"]
    for name in ("base", "filled"):
        row = result[name]
        lines.append(f"| {name} | {row['rank_d0']} | {row['rank_d1']} | {row['h0']} | {row['h1']} | {row['h2']} |")
    lines += ["", "| Observation | Complex | gradient² | coexact² | harmonic² | compatibility residual² | face syndrome |",
              "|---|---|---:|---:|---:|---:|---|"]
    for name, case in result["examples"].items():
        for complex_name in ("base", "filled"):
            row = case[complex_name]
            lines.append(f"| {name} | {complex_name} | {row['gradient_norm_squared']} | {row['coexact_norm_squared']} | {row['harmonic_norm_squared']} | {row['residual_norm_squared']} | {','.join(map(str, row['face_syndrome']))} |")
    relative = result["relative_visible_subcomplex"]
    lines += ["", "Edge order: 01 count, 12 count, 02 count/handoff, 23 handoff, 03 handoff.",
              "The 012 face reads count; the optional 023 face reads handoff.",
              f"Edge-group code distance: {result['sheaf_code']['distance_edge_groups']}.",
              f"Visible 0,1,2 with edges 01,12: dim H0(K)={relative['h0_k']}, dim H0(L)={relative['h0_l']}, restriction rank={relative['restriction_rank']}, dim H1(K,L)={relative['h1_relative']}, connecting rank={relative['connecting_rank']}.",
              "Unequal endpoint handoffs are locally compatible on L but have a nonzero connecting class."]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--format", choices=("json", "markdown"), default="markdown")
    args = parser.parse_args()
    result = study()
    print(json.dumps(fraction_json(result), indent=2) if args.format == "json" else markdown(result), end="" if args.format == "markdown" else "\n")


if __name__ == "__main__":
    main()
