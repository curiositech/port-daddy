#!/usr/bin/env python3
import re
import sys
from pathlib import Path

def audit_file(path):
    text = Path(path).read_text(encoding='utf-8')
    # Find all \fontsize{size}{baseline}
    matches = re.findall(r'\\fontsize\{([0-9.]+)\}\{([0-9.]+)\}', text)
    errors = []
    for size, baseline in matches:
        s = float(size)
        # Rendered pixel size at 150 DPI = s * (150/72)
        px_150 = s * 150.0 / 72.0
        # Rendered pixel size at 120 DPI = s * (120/72)
        px_120 = s * 120.0 / 72.0
        if s < 8.0:
            errors.append(f"Font size {s}pt is below floor 8.0pt (renders at {px_120:.1f}px @ 120DPI, {px_150:.1f}px @ 150DPI)")
    
    # Check for tiny/scriptsize
    if re.search(r'\\tiny\b', text):
        errors.append(r"Uses forbidden \tiny")
    if re.search(r'\\scriptsize\b', text):
        errors.append(r"Uses forbidden \scriptsize")
        
    # Strip comments
    uncommented = re.sub(r'%.*$', '', text, flags=re.MULTILINE)
    # Check for duplicate title banner inside actual TeX commands
    if re.search(r'\\node.*?(?:PROPOSITION \d|FIGURE \d|Chapter \d:)', uncommented, re.IGNORECASE):
        errors.append("Contains redundant figure/chapter title banner inside drawing")
        
    return errors

if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else 'website-v2/public/whitepaper/figures/fig-spark-prop1-funnel.tex'
    errs = audit_file(target)
    if errs:
        print(f"FAIL: {target}")
        for e in errs:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print(f"PASS: {target} satisfies typography and layout doctrine.")
        sys.exit(0)
