"""Exercise only the diagnostic's guards; never launch its build or write files."""
import ast
import hashlib
from pathlib import Path
import types
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('build-isolated.py')
TREE = ast.parse(SCRIPT.read_text(), filename=str(SCRIPT))
BOUNDARY_END = next(i for i, node in enumerate(TREE.body)
                    if isinstance(node, ast.Assign)
                    and any(isinstance(t, ast.Name) and t.id == 'paths'
                            for t in node.targets))
GUARDS = [node for node in TREE.body if isinstance(node, ast.If)
          and any(isinstance(child, ast.Raise)
                  and isinstance(child.exc, ast.Call)
                  and isinstance(child.exc.func, ast.Name)
                  and child.exc.func.id == 'RuntimeError'
                  for child in node.body)]
ROOT = '/Users/erichowens/coding/tmp/book-textbook-craft-20261103'
BRANCH = 'codex/book-textbook-craft-20261103'


def execute(nodes, level, namespace):
    module = ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[]))
    exec(compile(module, str(SCRIPT), 'exec', optimize=level), namespace)


class GuardTests(unittest.TestCase):
    def test_all_five_safety_guards_are_explicit(self):
        self.assertEqual(len(GUARDS), 5)
        self.assertFalse(any(isinstance(n, ast.Assert) for n in ast.walk(TREE)))

    def test_worktree_boundaries_survive_optimization(self):
        cases = [(ROOT, BRANCH, None), ('/unexpected/primary', BRANCH, 'root'),
                 (ROOT, 'main', 'branch'), (ROOT, 'master', 'branch'),
                 (ROOT, '', 'branch')]
        for level in (0, 1, 2):
            for actual_root, actual_branch, error in cases:
                with self.subTest(optimize=level, root=actual_root, branch=actual_branch):
                    with patch('subprocess.check_output', side_effect=[actual_root, actual_branch]) as git:
                        namespace = {'__file__': str(SCRIPT)}
                        if error:
                            with self.assertRaisesRegex(RuntimeError, 'Unexpected worktree ' + error):
                                execute(TREE.body[:BOUNDARY_END], level, namespace)
                        else:
                            execute(TREE.body[:BOUNDARY_END], level, namespace)
                        self.assertEqual(git.call_count, 1 if error == 'root' else 2)

    def test_source_drift_check_survives_optimization(self):
        for level in (0, 1, 2):
            for drift in ([], ['whitepaper/changed.tex']):
                with self.subTest(optimize=level, drift=drift):
                    if drift:
                        with self.assertRaisesRegex(RuntimeError, 'Source inputs changed'):
                            execute([GUARDS[2]], level, {'drift': drift})
                    else:
                        execute([GUARDS[2]], level, {'drift': drift})

    def test_accepted_pdf_check_survives_optimization(self):
        before = hashlib.sha256(b'accepted').hexdigest()
        for level in (0, 1, 2):
            for content in (b'accepted', b'changed'):
                with self.subTest(optimize=level, content=content):
                    namespace = {'hashlib': hashlib, 'before': before,
                                 'accepted': types.SimpleNamespace(read_bytes=lambda: content)}
                    if content != b'accepted':
                        with self.assertRaisesRegex(RuntimeError, 'Accepted Suisse cache PDF changed'):
                            execute([GUARDS[3]], level, namespace)
                    else:
                        execute([GUARDS[3]], level, namespace)

    def test_cache_isolation_check_survives_optimization(self):
        for level in (0, 1, 2):
            for bad in ([], ['INPUT .cache/whitepaper-build/canonical.aux']):
                with self.subTest(optimize=level, bad=bad):
                    if bad:
                        with self.assertRaisesRegex(RuntimeError, 'Isolated proof read canonical cache'):
                            execute([GUARDS[4]], level, {'bad': bad})
                    else:
                        execute([GUARDS[4]], level, {'bad': bad})


if __name__ == '__main__':
    unittest.main()
