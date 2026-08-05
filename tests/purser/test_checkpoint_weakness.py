import re

def test_checkpoint_description():
    with open('whitepaper/single-writer-kernel.tex', 'r') as f:
        tex_content = f.read()

    # Check for 'weakest continuity link' in checkpoint section
    assert 'weakest continuity link' in tex_content, "Checkpoint not marked as weakest continuity link"
    # Check for 'execution-state snapshot' requirement
    assert 'execution-state snapshot' in tex_content, "Checkpoint teeth not described"

test_checkpoint_description()