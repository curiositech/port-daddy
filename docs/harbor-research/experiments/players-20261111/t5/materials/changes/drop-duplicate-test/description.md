# tests: drop a duplicated bond test

`test_cannot_release_more_than_held` and `test_release_more_than_held_raises` in tests/test_bonds.py have the same body, line for line. This removes the second one. The suite runs 46 tests, one fewer.
