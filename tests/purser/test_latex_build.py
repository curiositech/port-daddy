import subprocess

def test_latex_compilation():
    result = subprocess.run(['pdflatex', '-interaction=nonstopmode', 'whitepaper/single-writer-kernel.tex'], capture_output=True, text=True)
    assert 'No errors' in result.stdout, "LaTeX compilation failed with errors"

test_latex_compilation()