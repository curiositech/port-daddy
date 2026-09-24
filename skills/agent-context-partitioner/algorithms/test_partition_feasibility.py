import unittest
from partition_feasibility import Item, Target, propose

class PartitionTests(unittest.TestCase):
    def setUp(self):
        self.targets=[Target('a',100,frozenset({'read'}),frozenset({'team'})),
                      Target('b',100,frozenset({'read','write'}),frozenset({'team'}))]
    def test_dependency_transfer_is_explicit(self):
        r=propose([Item('source',60),Item('review',50,parents=('source',))],self.targets,inventory_complete=True)
        self.assertEqual(r.status,'FEASIBLE')
        self.assertTrue(all(x in r.transfers[0] for x in ('source','a','b')))
    def test_missing_parent_is_unknown(self):
        r=propose([Item('child',1,parents=('unknown',))],self.targets,inventory_complete=True)
        self.assertEqual(r.status,'UNKNOWN')
    def test_incompatible_scope_is_infeasible(self):
        r=propose([Item('secret',1,audiences=frozenset({'private'}))],self.targets,inventory_complete=True)
        self.assertEqual(r.status,'INFEASIBLE')
    def test_incomplete_target_inventory_is_unknown(self):
        r=propose([Item('x',1)],self.targets,inventory_complete=False)
        self.assertEqual(r.status,'UNKNOWN')
    def test_capacity_is_hard_constraint(self):
        r=propose([Item('x',101)],self.targets,inventory_complete=True)
        self.assertEqual(r.status,'INFEASIBLE')
    def test_cycle_is_rejected(self):
        r=propose([Item('a',1,parents=('b',)),Item('b',1,parents=('a',))],self.targets,inventory_complete=True)
        self.assertEqual(r.status,'INFEASIBLE')

if __name__ == '__main__': unittest.main()
