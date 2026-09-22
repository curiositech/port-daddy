"""Exercise both existing figure batch methods with synthetic AUX, no PDF/model run."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
BEFORE=b'\\newlabel{fig:x}{{1}{1}{Old}{figure.1}{}}\n'
AFTER=b'\\newlabel{fig:x}{{2}{9}{New}{figure.2}{}}\n'
REPORT=dict(baseline_aux_sha256=hashlib.sha256(BEFORE).hexdigest(),
    before={'fig:x':{'number':'1','anchor':'figure.1'}},
    after={'fig:x':{'number':'2','anchor':'figure.2'}},
    unresolved={},insertions=[],inserted_records=[],shifts=['fig:x'])
TARGETS=[('test_laundering_figure.py','LaunderingFigureTests',
          'test_batch_keeps_all_numbers_and_anchors','BOOK_PAYLOAD'),
         ('test_receipt_gap_figure.py','ReceiptGapFigureTests',
          'test_no_number_or_anchor_changes_in_this_batch','BOOK_RECEIPT')]

def invoke(target, after, report_text=None, explicit=False, path='migration.json', inputs=True, report_error=None):
    filename,cls,method,prefix=target
    env={prefix+'_PDF':'candidate.pdf',prefix+'_BEFORE_AUX':'baseline.aux'} if inputs else {}
    if explicit: env['BOOK_FIGURE_EXPECTED_MIGRATION']=path
    with patch.dict(os.environ,env,clear=True):
        spec=importlib.util.spec_from_file_location('routing_'+prefix,HERE/filename)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        case=getattr(module,cls)(method)
        fn=getattr(case,method)
        if explicit or inputs:
            assert not getattr(fn,'__unittest_skip__',False), 'Explicit migration was skipped'
        with patch.object(Path,'read_bytes',side_effect=[BEFORE,after]), \
             patch.object(Path,'read_text',return_value=report_text,side_effect=report_error) as read_report:
            fn()
            if explicit: read_report.assert_called_once()
            else: read_report.assert_not_called()

class FigureMigrationRouting(unittest.TestCase):
    def test_default_unchanged_passes_and_shift_rejected(self):
        for target in TARGETS:
            with self.subTest(target=target[0]):
                invoke(target,BEFORE)
                with self.assertRaises(AssertionError): invoke(target,AFTER)

    def test_explicit_migration_routes_exact_audit(self):
        for target in TARGETS:
            with self.subTest(target=target[0]):
                invoke(target,AFTER,json.dumps(REPORT),explicit=True)
                with self.assertRaises(AssertionError):
                    invoke(target,BEFORE,json.dumps(REPORT),explicit=True)

    def test_invalid_report_never_falls_back_to_unchanged(self):
        for target in TARGETS:
            for text in ('{','null','{}',json.dumps({**REPORT,'section_star_contents_before':[]})):
                with self.subTest(target=target[0],text=text), self.assertRaises((ValueError,KeyError,TypeError)):
                    invoke(target,BEFORE,text,explicit=True)

    def test_wrong_baseline_and_explicit_empty_path_fail(self):
        for target in TARGETS:
            with self.subTest(target=target[0]):
                with self.assertRaisesRegex(ValueError,'SHA256'):
                    invoke(target,AFTER,json.dumps({**REPORT,'baseline_aux_sha256':'wrong'}),explicit=True)
                with self.assertRaises(AssertionError): invoke(target,BEFORE,explicit=True,path='')
                with self.assertRaises(AssertionError): invoke(target,BEFORE,explicit=True,inputs=False)

    def test_missing_report_file_errors_propagate(self):
        for target in TARGETS:
            with self.subTest(target=target[0]):
                with self.assertRaises(FileNotFoundError):
                    invoke(target,BEFORE,explicit=True,report_error=FileNotFoundError('missing explicit report'))

if __name__=='__main__':unittest.main()
