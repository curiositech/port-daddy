#!/usr/bin/env python3
"""Extract the typography review from the assembled Book, never chapter PDFs.

Usage: python3 scripts/harbor-research/export_book_type_review.py BOOK.pdf REVIEW.pdf
The Book's .aux file must sit beside the PDF. All selections follow current
labels and bookmarks, so repagination cannot silently change the witnesses.
Review links into omitted pages are deliberately removed; use the full Book
to check navigation. Four PNG witnesses are written beside the review PDF.
"""
import argparse
from pathlib import Path
import re

import fitz


def export_review(source, destination):
    if source.resolve() == destination.resolve():
        raise ValueError("The review must not overwrite the assembled Book")
    with fitz.open(source) as book, fitz.open() as proof:
        aux = source.with_suffix(".aux").read_text()
        outline = book.get_toc()

        def page_for_label(key):
            match = re.search(r"\\newlabel\{" + re.escape(key)
                              + r"\}\{\{[^{}]*\}\{([^{}]+)\}", aux)
            if not match:
                raise ValueError(f"Missing assembled Book label: {key}")
            indices = [i for i, page in enumerate(book) if page.get_label() == match.group(1)]
            if len(indices) != 1:
                raise ValueError(f"Ambiguous printed folio for {key}: {indices}")
            return indices[0]

        toc_start = next(row[2] - 1 for row in outline if row[1] == "Contents")
        intro = next(row[2] - 1 for row in outline
                     if row[1] == "1 Introduction: the unit of account is the work")
        chapter = page_for_label("chap:swk")
        maya = page_for_label("ls:fig:split-ranker")
        left, right = (page_for_label("book:reader-" + side) for side in ("left", "right"))
        pages = [(0, "Cover: shared sans display"), (left, "Reader map: prose starts left"),
                 (right, "Reader map: continuation right")]
        pages += [(i, f"Complete contents: {book[i].get_label()}") for i in range(toc_start, intro)]
        pages += [(chapter, "Chapter opening: display and text roles"),
                  (chapter + 2, "Continuous prose: shared sans"),
                  (page_for_label("chap:anchor"), "Chapter opening: longer question and epigraph")]
        pages += [(i, f"Maya: book page {book[i].get_label()}") for i in range(maya - 1, maya + 2)]

        seen, bookmarks, labels = set(), [], []
        for index, title in pages:
            if index in seen:
                continue
            seen.add(index)
            proof.insert_pdf(book, from_page=index, to_page=index, links=False)
            bookmarks.append([1, title, len(proof)])
            labels.append({"startpage": len(proof) - 1, "prefix": book[index].get_label()})
        proof.set_toc(bookmarks)
        proof.set_page_labels(labels)
        proof.set_metadata({"title": "Book sans, contents, and Maya — visual proof",
                            "subject": "Excerpt from the assembled Book; use the full Book for navigation links."})
        proof.save(destination, garbage=4, deflate=True)
        for key, index in [("reader-left", left), ("contents-first", toc_start),
                           ("chapter-opening", chapter), ("maya-slopegraph", maya)]:
            book[index].get_pixmap(dpi=130).save(destination.with_name(key + ".png"))
        print(f"{len(proof)} review pages from {len(book)} assembled Book pages: {destination}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("book", type=Path)
    parser.add_argument("review", type=Path)
    args = parser.parse_args()
    export_review(args.book, args.review)
