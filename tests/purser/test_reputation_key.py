import re

def test_reputation_description():
    with open('whitepaper/single-writer-kernel.tex', 'r') as f:
        tex_content = f.read()

    # Check for 'richer third organ' in witnessed-outcome ledger
    assert 'richer third organ' in tex_content, "Ledger reputation key not properly described"
    # Check for 'partial substrate' mention
    assert 'partial substrate' in tex_content, "Ledger substrate status not properly described"

test_reputation_description()