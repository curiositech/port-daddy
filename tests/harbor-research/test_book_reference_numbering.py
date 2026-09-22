"""In-memory acceptance/rejection tests; no fixtures or canonical files written."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('checker', ROOT / 'scripts/harbor-research/check_book_reference_numbering.py')
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
REPORT_PATH = os.environ.get('BOOK_BLOCK_EXPECTED_RENUMBERING')
REPORT = json.loads(Path(REPORT_PATH).read_text()) if REPORT_PATH else {}
BEFORE = Path(REPORT['old_aux']).read_bytes() if REPORT_PATH else b''

def serialize(labels):
    return ('\n'.join('\\newlabel{' + n + '}{' + ''.join('{' + f + '}' for f in fields) + '}'
                     for n, fields in labels.items()) + '\n').encode()

def permitted_after():
    labels = checker.parse(BEFORE)
    for name, row in REPORT['expected'].items():
        labels[name][0], labels[name][3] = row['expected_number'], row['expected_anchor']
    for name, row in REPORT['explicit_label_migrations'].items():
        labels[name][0], labels[name][3] = row['expected_number'], row['expected_anchor']
    for name in REPORT['figure_insertion']['shift_labels']:
        labels[name][0] = checker.bump(labels[name][0])
        labels[name][3] = checker.bump(labels[name][3])
    for name in REPORT['allowed_removed_labels']:
        labels.pop(name)
        labels.pop(name + '@cref', None)
    ins = REPORT['figure_insertion']
    labels[ins['label']] = [ins['number'], '1', 'Topology', ins['anchor'], '']
    return labels

@unittest.skipUnless(REPORT_PATH, 'dated migration report not supplied')
class NumberingTests(unittest.TestCase):
    def test_exact_allowances_pass(self):
        result = checker.audit(BEFORE, serialize(permitted_after()), REPORT)
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['theorem_labels'], 94)
        self.assertEqual(result['changed_theorem_labels'], 36)
        self.assertEqual(result['shifted_FH_figures'], 7)

    def test_wrong_baseline_hash_rejected(self):
        with self.assertRaisesRegex(ValueError, 'SHA256'):
            checker.audit(BEFORE + b'\n', serialize(permitted_after()), REPORT)

    def test_migration_is_exact_not_a_type_wildcard(self):
        for field, wrong in ((0, '4.4.4'), (3, 'theorem.4.4.3'), (3, 'pdworkedexample.4.4.4')):
            labels = permitted_after()
            labels['ls:hyp:spec-variance'][field] = wrong
            self.assertFalse(checker.audit(BEFORE, serialize(labels), REPORT)['ok'])
        altered = json.loads(json.dumps(REPORT))
        altered['explicit_label_migrations']['ls:hyp:spec-variance']['expected_number'] = '4.4.4'
        with self.assertRaisesRegex(ValueError, 'approved exact transition'):
            checker.audit(BEFORE, serialize(permitted_after()), altered)

    def test_each_protected_kind_rejects_number_change(self):
        for kind in ('theorem', 'definition', 'property', 'equation', 'table', 'figure'):
            with self.subTest(kind=kind):
                labels = permitted_after()
                name = next(n for n, f in labels.items() if checker.kind(f) == kind)
                labels[name][0] += '9'
                result = checker.audit(BEFORE, serialize(labels), REPORT)
                self.assertFalse(result['ok'])
                self.assertIn(name, [f['label'] for f in result['failures']])

    def test_missing_unapproved_new_and_duplicate_rejected(self):
        labels = permitted_after()
        name = next(iter(REPORT['expected']))
        labels.pop(name)
        self.assertFalse(checker.audit(BEFORE, serialize(labels), REPORT)['ok'])
        labels = permitted_after()
        labels['fh:tab:unexpected'] = ['8.99', '1', '', 'table.8.99', '']
        self.assertFalse(checker.audit(BEFORE, serialize(labels), REPORT)['ok'])
        data = serialize(permitted_after())
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            checker.audit(BEFORE, data + data, REPORT)

    def test_insertion_and_removal_required(self):
        labels = permitted_after()
        labels.pop(REPORT['figure_insertion']['label'])
        self.assertFalse(checker.audit(BEFORE, serialize(labels), REPORT)['ok'])
        labels = permitted_after()
        name = REPORT['allowed_removed_labels'][0]
        labels[name] = checker.parse(BEFORE)[name]
        self.assertFalse(checker.audit(BEFORE, serialize(labels), REPORT)['ok'])

    def test_page_and_title_changes_do_not_affect_numbering(self):
        labels = permitted_after()
        for name, fields in labels.items():
            if checker.numbered(name, fields):
                fields[1] = '999'
                if len(fields) > 2:
                    fields[2] = 'Changed Title'
        self.assertTrue(checker.audit(BEFORE, serialize(labels), REPORT)['ok'])

if __name__ == '__main__':
    unittest.main(verbosity=2)
