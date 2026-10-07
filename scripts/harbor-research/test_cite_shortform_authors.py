"""Counterexamples for first-author attribution in compact Book sources."""
import unittest

from build_cite_shortforms import parse_authors


class FirstAuthorTests(unittest.TestCase):
    def test_partial_list_does_not_credit_last_named_author(self):
        self.assertEqual(parse_authors(
            'Lianmin Zheng, Wei-Lin Chiang, Ying Sheng, Siyuan Zhuang, '
            'Zhanghao Wu, Yonghao Zhuang, et al.'), 'Zheng et al.')

    def test_already_abbreviated_list(self):
        self.assertEqual(parse_authors('Lianmin Zheng et al.'), 'Zheng et al.')

    def test_conjunction_before_abbreviation(self):
        self.assertEqual(parse_authors('Ada Lovelace and Alan Turing et al.'),
                         'Lovelace et al.')

    def test_surname_particles_survive(self):
        self.assertEqual(parse_authors('John von Neumann, Alan Turing, et al.'),
                         'von Neumann et al.')

    def test_two_authors_are_not_abbreviated(self):
        self.assertEqual(parse_authors('Danny Dolev and Andrew Yao.'),
                         r'Dolev \& Yao')


if __name__ == '__main__':
    unittest.main()
