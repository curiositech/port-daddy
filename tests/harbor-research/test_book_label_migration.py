"""Exact-label gate rejection fixtures; expected maps remain reviewed input."""
import copy
import hashlib
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "label_gate", ROOT / "scripts/harbor-research/check_book_label_migration.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def encode(rows):
    return ("\n".join(r"\newlabel{" + name + "}{" +
                      "".join("{"+value+"}" for value in fields) + "}"
                      for name, fields in rows.items())+"\n").encode()


class LabelMigrationChecks(unittest.TestCase):
    def setUp(self):
        self.before_rows = {
            "stp:thm:x": ["5.6.2", "100", "Old", "theorem.5.6.2", ""],
            "stp:thm:x@cref": ["[theorem][2][5,6]5.6.2", "[1][100][]100"],
            "stp:tab:x": ["5.5", "101", "Table", "table.5.5", ""],
        }
        self.after_rows = copy.deepcopy(self.before_rows)
        self.after_rows["stp:thm:x"][0] = "5.6.3"
        self.after_rows["stp:thm:x"][3] = "theorem.5.6.3"
        self.after_rows["stp:thm:x@cref"][0] = "[theorem][3][5,6]5.6.3"
        self.after_rows["stp:ex:new"] = ["5.6.2", "100", "Example", "pdworkedexample.5.6.2", ""]
        self.before = encode(self.before_rows)
        self.report = {
            "baseline_aux_sha256": hashlib.sha256(self.before).hexdigest(),
            "unresolved": {}, "before": gate.signatures(self.before),
            "after": gate.signatures(encode(self.after_rows)),
            "inserted_records": ["stp:ex:new"],
            "shifts": ["stp:thm:x"], "insertions": ["stp:ex:new"],
        }

    def check(self, rows):
        return gate.audit(self.before, encode(rows), self.report)["ok"]

    def test_exact_changes_pass_and_pages_titles_may_move(self):
        self.assertTrue(self.check(self.after_rows))
        rows = copy.deepcopy(self.after_rows)
        for name, fields in rows.items():
            if name.endswith("@cref"):
                fields[1] = "[1][999][]999"
            else:
                fields[1:3] = ["999", "New Title"]
        self.assertTrue(self.check(rows))

    def test_numbers_types_cref_ordinals_and_table_changes_rejected(self):
        for label, index, value in (
            ("stp:thm:x", 0, "5.6.4"),
            ("stp:ex:new", 3, "theorem.5.6.2"),
            ("stp:thm:x@cref", 0, "[theorem][9][5,6]5.6.3"),
            ("stp:tab:x", 0, "5.6"),
        ):
            with self.subTest(label=label, index=index):
                rows = copy.deepcopy(self.after_rows)
                rows[label][index] = value
                self.assertFalse(self.check(rows))

    def test_unapproved_additions_removals_duplicates_rejected(self):
        rows = copy.deepcopy(self.after_rows)
        rows.pop("stp:tab:x")
        self.assertFalse(self.check(rows))
        rows = copy.deepcopy(self.after_rows)
        rows["stp:extra"] = ["5.9", "1", "Extra", "table.5.9", ""]
        self.assertFalse(self.check(rows))
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            gate.parse(encode(self.after_rows)*2)

    def test_wrong_baseline_and_inconsistent_report_rejected(self):
        with self.assertRaisesRegex(ValueError, "SHA256"):
            gate.audit(self.before+b"\n", encode(self.after_rows), self.report)
        report = copy.deepcopy(self.report)
        report["inserted_records"] = []
        with self.assertRaisesRegex(ValueError, "insertion"):
            gate.audit(self.before, encode(self.after_rows), report)

    def section_fixture(self):
        old = b'\\@writefile{toc}{\\contentsline {paragraph}{A {nested} title}{10}{section*.7}}\n'
        new = old.replace(b'{10}{section*.7}', b'{99}{section*.8}')
        before, after = self.before+old, encode(self.after_rows)+new
        report = copy.deepcopy(self.report)
        report['baseline_aux_sha256'] = hashlib.sha256(before).hexdigest()
        report['section_star_contents_before'] = gate.section_star_contents(before)
        report['section_star_contents_after'] = gate.section_star_contents(after)
        return before, after, report

    def test_optional_sections_exact_and_page_reflow_pass(self):
        before, after, report = self.section_fixture()
        self.assertTrue(gate.audit(before, after, report)['ok'])
        self.assertTrue(gate.audit(before, after.replace(b'{99}',b'{999}'), report)['ok'])
        self.assertEqual(len(report['before']), 3)  # no hardcoded Book size

    def test_legacy_omitted_fields_retain_label_only_behavior(self):
        before, after, report = self.section_fixture()
        del report['section_star_contents_before']; del report['section_star_contents_after']
        self.assertTrue(gate.audit(before, after.replace(b'section*.8',b'section*.999'), report)['ok'])

    def test_explicit_empty_section_lists_enforce_no_records(self):
        report = copy.deepcopy(self.report)
        report.update(section_star_contents_before=[], section_star_contents_after=[])
        self.assertTrue(gate.audit(self.before, encode(self.after_rows), report)['ok'])
        extra = b'\\@writefile{toc}{\\contentsline {paragraph}{Added}{1}{section*.1}}\n'
        self.assertFalse(gate.audit(self.before, encode(self.after_rows)+extra, report)['ok'])

    def test_section_anchor_title_kind_addition_removal_and_order_rejected(self):
        before, after, report = self.section_fixture()
        for bad in (after.replace(b'section*.8',b'section*.7'),
                    after.replace(b'A {nested} title',b'Other title'),
                    after.replace(b'{paragraph}',b'{subparagraph}'),
                    encode(self.after_rows), after+after.splitlines(keepends=True)[-1]):
            with self.subTest(bad=bad[-100:]):
                self.assertFalse(gate.audit(before,bad,report)['ok'])
        second = b'\\@writefile{toc}{\\contentsline {paragraph}{Second}{1}{section*.9}}\n'
        report['section_star_contents_after'] = gate.section_star_contents(after+second)
        reordered = encode(self.after_rows)+second+after.splitlines(keepends=True)[-1]
        self.assertFalse(gate.audit(before,reordered,report)['ok'])

    def test_malformed_explicit_section_fields_fail_closed(self):
        before, after, report = self.section_fixture()
        for value in (None, {}, 'ignored', 0, [None], [{}],
                      [dict(stream='toc',kind='paragraph',title='X',anchor='figure.1')],
                      [dict(stream='toc',kind='paragraph',title=3,anchor='section*.1')],
                      [dict(stream='toc',kind='paragraph',title='X',anchor='section*.1',extra='x')]):
            with self.subTest(value=value), self.assertRaises(ValueError):
                bad=copy.deepcopy(report);bad['section_star_contents_after']=value
                gate.audit(before,after,bad)
        for key in ('section_star_contents_before','section_star_contents_after'):
            bad=copy.deepcopy(report);del bad[key]
            with self.assertRaises(ValueError): gate.audit(before,after,bad)
        with self.assertRaises(ValueError): gate.audit(before,after,[])

    def test_reviewed_title_only_change_is_explicit_and_exact(self):
        import json
        before,after,_=self.section_fixture()
        change={'anchor':'section*.7','before':'A {nested} title','after':'Corrected title'}
        old=gate.section_star_contents(before)
        self.assertEqual(gate.expected_section_star_contents(before),old)
        with patch.object(gate.Path,'read_text',return_value=json.dumps([change])):
            result=gate.expected_section_star_contents(before,'reviewed-retitles.json')
        self.assertEqual(result,[dict(old[0],title='Corrected title')])
        self.assertEqual(gate.section_star_contents(before),old,'Input must not be rewritten')
        for bad in (None,{},[None],[change,change],
                    [dict(change,before='Wrong')],[dict(change,anchor='section*.99')],
                    [dict(change,after='')],[dict(change,kind='section')]):
            with self.subTest(bad=bad),patch.object(gate.Path,'read_text',return_value=json.dumps(bad)),self.assertRaises(ValueError):
                gate.expected_section_star_contents(before,'reviewed-retitles.json')

    def test_baseline_section_mismatch_and_malformed_aux_fail(self):
        before,after,report=self.section_fixture()
        bad=copy.deepcopy(report);bad['section_star_contents_before'][0]['anchor']='section*.6'
        with self.assertRaisesRegex(ValueError,'baseline section-star'):
            gate.audit(before,after,bad)
        for malformed in (b'\\@writefile{toc}{\\contentsline {paragraph}{X}{1}}\n',
                          b'\\@writefile{toc}{\\contentsline {paragraph}{X}{1}{section*.bad}}\n'):
            with self.assertRaises(ValueError): gate.audit(before,encode(self.after_rows)+malformed,report)


if __name__ == "__main__":
    unittest.main()
