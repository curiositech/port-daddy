import re

def test_non_provisions():
    with open('whitepaper/single-writer-kernel.tex', 'r') as f:
        tex_content = f.read()

    # Check for non-forgeable identity status
    assert 'BuiltWeak' in tex_content and 'universal write gating absent' in tex_content, "Non-forgeable identity not properly documented"
    # Check for unimplemented features
    assert 'cross-organ transactional atomicity' in tex_content and 'real execution-checkpoint' in tex_content, "Unimplemented features not listed in non-provisions"

test_non_provisions()