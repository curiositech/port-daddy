import re

def test_continuity_terms():
    with open('whitepaper/single-writer-kernel.tex', 'r') as f:
        tex_content = f.read()

    # Check 'witnessed-outcome ledger' references
    assert re.search(r'witnessed-outcome ledger.*partial', tex_content), "Ledger not marked as partial"
    # Check 'checkpoint' references
    assert re.search(r'checkpoint.*weakest continuity link', tex_content), "Checkpoint not marked as weakest continuity link"
    # Check for 'execution-state snapshot' mention
    assert 'execution-state snapshot' in tex_content, "Checkpoint teeth not described"

test_continuity_terms()