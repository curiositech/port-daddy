import re

def test_mechanism_map():
    with open('whitepaper/single-writer-kernel.tex', 'r') as f:
        tex_content = f.read()

    # Check identity enforcement status
    assert 'actor-souls' in tex_content and 'bounded gate ships' in tex_content, "Mechanism-to-artifact map identity entry incorrect"
    # Check for missing full write-boundary enforcement
    assert 'full write-boundary enforcement absent' in tex_content, "Mechanism-to-artifact map missing enforcement status"

test_mechanism_map()