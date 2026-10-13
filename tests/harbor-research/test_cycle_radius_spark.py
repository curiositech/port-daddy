"""Check the plotted cycle law via an independent exact electrical solve."""
from fractions import Fraction as Q
from math import sqrt
import unittest


def resistance(n, cycle):
    # Unit current enters vertex 0 and leaves grounded vertex n-1.
    edges = [(i, i+1) for i in range(n-1)]
    if cycle:
        edges.append((n-1, 0))
    size = n-1
    a = [[Q(0) for _ in range(size+1)] for _ in range(size)]
    for u, v in edges:
        if u < size:
            a[u][u] += 1
        if v < size:
            a[v][v] += 1
        if u < size and v < size:
            a[u][v] -= 1
            a[v][u] -= 1
    a[0][-1] = Q(1)
    for col in range(size):
        pivot = next(row for row in range(col, size) if a[row][col])
        a[col], a[pivot] = a[pivot], a[col]
        factor = a[col][col]
        a[col] = [x/factor for x in a[col]]
        for row in range(size):
            if row != col:
                factor = a[row][col]
                a[row] = [x-factor*y for x, y in zip(a[row], a[col])]
    return a[0][-1]


class CycleRadius(unittest.TestCase):
    def test_each_plotted_integer(self):
        for n in range(4, 25):
            r_eff = resistance(n, cycle=True)
            self.assertEqual(1-r_eff, Q(1, n))
            self.assertAlmostEqual(sqrt(float(1-r_eff)), 1/sqrt(n))

    def test_cycle_is_not_path_end_to_end(self):
        # A path endpoint pair is not itself an edge unless n=2.
        # Its resistance is n-1; substituting it for a cycle edge is invalid.
        self.assertEqual(resistance(6, cycle=False), Q(5))
        self.assertEqual(resistance(2, cycle=False), Q(1))

    def test_worked_value(self):
        self.assertAlmostEqual(3*sqrt(float(1-resistance(6, True))), 1.224744871391589)


if __name__ == "__main__":
    unittest.main()
