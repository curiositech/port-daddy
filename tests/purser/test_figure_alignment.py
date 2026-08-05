import re

def test_figure_labels():
    with open('whitepaper/figures/fig-swk-continuity-organs.tex', 'r') as f:
        tex_content = f.read()

    # Check for 'partial' instead of 'specified' in ledger
    assert 'partial' in tex_content, "Ledger status not marked as 'partial'"
    # Check for 'weakest continuity link' in checkpoint
    assert 'weakest continuity link' in tex_content, "Checkpoint not marked as weakest continuity link"
    # Check for 'partial substrate' in ledger description
    assert 'partial substrate' in tex_content, "Ledger substrate status not properly described"

test_figure_labels()