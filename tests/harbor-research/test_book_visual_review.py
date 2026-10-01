"""The caption inventory includes inline exhibits without granting approval."""
import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/harbor-research'))
from export_book_visual_review import caption_records


class VisualReviewInventoryTests(unittest.TestCase):
    def test_inline_caption_without_label_is_inventoried(self):
        aux = r'\@writefile{lof}{\contentsline {figure}{\numberline {2.3}{A claim}}{14}{figure.2.3}}'
        rows = caption_records(aux)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['number'], '2.3')
        self.assertEqual(rows[0]['labels'], [])
        self.assertEqual(rows[0]['design_review'], 'unreviewed')

    def test_table_and_legacy_alias_are_one_exhibit(self):
        aux = '\n'.join([
            r'\newlabel{he:tab:purchases}{{6.1}{40}{Nested \textbf{title}}{table.6.1}{}}',
            r'\newlabel{he:fig:legacy}{{6.1}{40}{Title}{table.6.1}{}}',
            r'\newlabel{he:fig:legacy@cref}{{[table][1][]6.1}{[1][40][]40}}',
            r'\@writefile{lot}{\contentsline {table}{\numberline {6.1}{Title}}{40}{table.6.1}}',
        ])
        rows = caption_records(aux)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['labels'], ['he:tab:purchases', 'he:fig:legacy'])
        self.assertEqual(rows[0]['kind'], 'table')

    def test_toc_entries_are_not_visuals(self):
        self.assertEqual(caption_records(r'\@writefile{toc}{\contentsline {chapter}{1}{1}{chapter.1}}'), [])

    def test_code_listing_caption_is_not_an_inventory_exception(self):
        aux = r'\@writefile{lol}{\contentsline {lstlisting}{\numberline {2.1}{Verifier}}{15}{lstlisting.2.1}}'
        rows = caption_records(aux)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['kind'], 'listing')
        self.assertEqual(rows[0]['destination'], 'lstlisting.2.1')


if __name__ == '__main__':
    unittest.main()
