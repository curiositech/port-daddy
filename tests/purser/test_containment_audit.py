import subprocess

def test_containment_audit():
    result = subprocess.run(['node', 'scripts/containment_audit.mjs'], capture_output=True, text=True)
    assert 'pass: true' in result.stdout and 'findings' not in result.stdout, "Containment audit failed or found issues"

test_containment_audit()