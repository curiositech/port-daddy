from PyPDF2 import PdfReader

def test_pdf_page_count():
    pdf_path = 'website-v2/public/whitepaper/single-writer-kernel-whitepaper.pdf'
    with open(pdf_path, 'rb') as f:
        reader = PdfReader(f)
        assert len(reader.pages) == 35, f"PDF has {len(reader.pages)} pages, expected 35"

test_pdf_page_count()