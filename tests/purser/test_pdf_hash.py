import hashlib
import os

def test_pdf_hash():
    # Read expected hash from markdown
    with open('docs/pr-assets/companion-paper-figure-repairs.md', 'r') as f:
        md_content = f.read()
    expected_hash = md_content.split('single-writer-kernel-whitepaper.pdf')[1].split('\n')[0].strip()

    # Compute actual hash
    pdf_path = 'website-v2/public/whitepaper/single-writer-kernel-whitepaper.pdf'
    with open(pdf_path, 'rb') as f:
        pdf_data = f.read()
    actual_hash = hashlib.sha256(pdf_data).hexdigest()

    assert actual_hash == expected_hash, f"Hash mismatch: expected {expected_hash}, got {actual_hash}"

test_pdf_hash()