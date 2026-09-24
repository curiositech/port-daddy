#!/usr/bin/env python3
"""Portable bounded regressions; requires only Python and NumPy."""
import contextlib
import importlib.util
import io
from pathlib import Path
import unittest
import numpy as np

spec = importlib.util.spec_from_file_location("harbor_cr4", Path(__file__).with_name("sheaf_repair_and_2complex.py"))
m = importlib.util.module_from_spec(spec)
output = io.StringIO()
with contextlib.redirect_stdout(output):
    spec.loader.exec_module(m)

class RepairContract(unittest.TestCase):
    def setUp(self):
        self.edges = [(0,1),(0,2),(1,2)]
        self.matrix,_ = m.build_simplicial_coboundaries(3,self.edges,[])
        self.values = np.array([2,2,1],dtype=float)
        self.costs = dict(zip(self.edges,[1,2,3]))
    def run_case(self, **patch):
        args = dict(delta_0=self.matrix,edges=self.edges,g_known=self.values,costs=self.costs)
        args.update(patch)
        return m.solve_cohomological_repair_greedy(**args)
    def test_import_is_silent(self):
        self.assertEqual(output.getvalue(),"")
    def test_positive_and_counterexample_fixtures(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(m.main(["--cr4-fixtures"]),0)
    def test_mutation_fixture_has_valid_off_support_premise(self):
        m.FAILURES.clear()
        with contextlib.redirect_stdout(io.StringIO()):m.run_mutation_suite()
        self.assertEqual(m.FAILURES,[])
    def test_reconcile_retains_all_constraints(self):
        result = self.run_case(mode="reconcile")
        self.assertEqual(result["interventions"],self.edges)
        self.assertEqual(result["retainedEdges"],self.edges)
        self.assertEqual(result["eligibleEdges"],[])
        self.assertEqual(result["modeledObservations"],[0.,0.,0.])
        self.assertEqual(result["status"],"completed")
        np.testing.assert_allclose(np.square(result["residualTrajectory"]),[1/3,1/3,1/3,0])
        np.testing.assert_array_equal(self.values,[2,2,1])
    def test_sever_removes_only_selected_rows(self):
        result = self.run_case()
        self.assertEqual(result["status"],"completed")
        self.assertEqual(result["retainedEdges"],result["eligibleEdges"])
        self.assertEqual(len(result["retainedEdges"]),2)
        for edge,value in zip(result["retainedEdges"],result["modeledObservations"]):
            self.assertEqual(value,self.values[self.edges.index(edge)])
    def test_consistent_and_empty_inputs(self):
        self.assertEqual(self.run_case(g_known=self.matrix@np.array([0.,1.,2.]))["status"],"already-consistent")
        result=m.solve_cohomological_repair_greedy(np.zeros((0,0)),[],[])
        self.assertEqual(result["status"],"already-consistent")
    def test_early_stop_does_not_claim_completion(self):
        result=self.run_case(score_tolerance=100)
        self.assertEqual(result["status"],"early-stop-zero-score")
        self.assertGreater(result["remainingResidual"],m.TOL)
        self.assertEqual(result["interventions"],[])
    def test_finite_nonnegative_tolerances(self):
        for field in ["tolerance","score_tolerance"]:
            for value in [float("nan"),float("inf"),-1]:
                with self.subTest(field=field,value=value),self.assertRaises(ValueError):
                    self.run_case(**{field:value})
    def test_graph_binding_and_edge_identity(self):
        cases=[dict(delta_0=np.zeros((3,3))),dict(edges=[(0,2),(0,1),(1,2)]),
               dict(edges=[(0,1),(0,1),(1,2)]),dict(edges=[(0,0),(0,2),(1,2)]),
               dict(edges=[(0,9),(0,2),(1,2)]),dict(edges=[(False,1),(0,2),(1,2)])]
        for patch in cases:
            with self.subTest(patch=patch),self.assertRaises(ValueError):self.run_case(**patch)
    def test_observation_shape_and_finiteness(self):
        for values in [2,[[2,2,1]],[2,2],[2,float("nan"),1]]:
            with self.subTest(values=values),self.assertRaises(ValueError):self.run_case(g_known=values)
    def test_cost_and_mode_validation(self):
        for bad in [0,-1,float("nan"),float("inf")]:
            costs=self.costs.copy();costs[self.edges[0]]=bad
            with self.subTest(cost=bad),self.assertRaises(ValueError):self.run_case(costs=costs)
        with self.assertRaises(ValueError):self.run_case(costs={})
        with self.assertRaises(ValueError):self.run_case(mode="optimise")
    def test_finite_inputs_cannot_emit_nonfinite_results(self):
        with self.assertRaises(ValueError):self.run_case(g_known=np.array([1e308,-1e308,1e308]))
        costs={edge:1e-320 for edge in self.edges}
        with self.assertRaises(ValueError):self.run_case(costs=costs,g_known=np.array([1e100,-1e100,1e100]))
    def test_integer_oracle_does_not_truncate(self):
        with self.assertRaises(ValueError):m.exact_integer_consistent(3,self.edges,[2,2,1.5],set())
        edges=[(0,1),(0,2),(1,2),(1,3),(2,3)]
        self.assertEqual(m.exact_integer_consistent(4,edges,[-1,-3,-3,-2,0],{2}),[0,1,3,3])

if __name__ == "__main__":
    unittest.main(verbosity=2)
