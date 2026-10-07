"""Check the retained bounded experiment without launching any runtime or provider."""
import hashlib
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
DATA=ROOT/'docs/harbor-research/experiments/handoff-coverage-20260920'


def missing(ledger,records):
    return [row['id'] for row in ledger if not any(
        r['id'] in row['allowed_source_ids'] and
        hashlib.sha256(r['text'].encode()).hexdigest()==row['text_sha256']
        for r in records)]


class HandoffEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.result=json.loads((DATA/'run-03/results.json').read_text())
        self.cases={r['fixture']:r for r in self.result['observations']}

    def test_archive_bytes_pinned(self):
        expected={'run-01/results.json':'3ba4e55c839177c248c951a9f43f117c323b743baaa0e2022c782a35d083d848',
                  'run-02/results.json':'d182dca64c064cfc546c810b980316f4eea60cd064a00984802a2aa68f38b152',
                  'run-03/results.json':'4650de5b6236e2f883b3de102b3626471b0074fbbd131963131122b57dc3b7c3',
                  'coverage_experiment.mjs':'6d719f45d94362248cab0979024ab7ce14606d0916c24acd36fe73c931461593',
                  'PROTOCOL.md':'816b486707b4279f0aa017e8d3629824724a0a02eca089aee54615887fadf32c'}
        for name,sha in expected.items():
            self.assertEqual(hashlib.sha256((DATA/name).read_bytes()).hexdigest(),sha,name)

    def test_source_and_extracted_ranges_match_observed_version(self):
        for record in self.result['source_evidence']:
            raw=(ROOT/record['path']).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(),record['sha256'])
            lines=raw.decode().split('\n')
            part='\n'.join('\n'.join(lines[a-1:b]) for a,b in record['ranges'])
            self.assertEqual(hashlib.sha256(part.encode()).hexdigest(),record['extracted_sha256'])

    def test_parent_reproduction_exact_except_run_identifier(self):
        a=json.loads((DATA/'run-02/results.json').read_text());b=self.result.copy()
        self.assertEqual(a.pop('run'),'run-02');self.assertEqual(b.pop('run'),'run-03')
        self.assertEqual(a,b)

    def test_every_fixed_case_including_restoration_and_no_requirement(self):
        expected={'recent':([],0,0),'old':(['OBL-01'],5,0),
                  'fourth-from-last':([],4,0),'long-item':(['OBL-01'],0,0),
                  'reaffirmed':([],6,0),'unconstrained':([],0,0)}
        self.assertEqual(set(self.cases),set(expected))
        for name,(absent,draft,final) in expected.items():
            row=self.cases[name]
            self.assertEqual(missing(row['required_ledger'],row['retained_operator_records']),absent)
            self.assertEqual(row['missing_obligations'],absent)
            self.assertEqual(row['draft_omitted']['tail'],draft)
            self.assertEqual(row['brief_omitted']['tail'],final)
            self.assertTrue(row['hash_matches'])
            self.assertTrue(row['capsule_transcript_ref'])
            self.assertFalse(row['brief_contains_transcript_ref'])
        self.assertFalse(self.cases['old']['prompt_contains_instruction'])
        self.assertTrue(self.cases['long-item']['truncation_marker'])

    def test_observer_checks_text_and_operator_provenance(self):
        row=self.cases['recent']; records=row['retained_operator_records'];ledger=row['required_ledger']
        self.assertEqual(missing(ledger,records),[])
        for lie in ({**records[0],'id':'forged'}, {**records[0],'text':'changed'}):
            self.assertEqual(missing(ledger,[lie]),['OBL-01'])
        self.assertEqual(missing(ledger,[]),['OBL-01'])
        self.assertEqual(missing([],[]),[])  # why output-derived requirements cannot be the judge
        self.assertEqual(len(self.result['checks']),11)
        self.assertEqual(len(self.result['controls']),7)
        self.assertTrue(all(self.result['checks'].values()))
        self.assertTrue(all(self.result['controls'].values()))


if __name__=='__main__':
    unittest.main()
