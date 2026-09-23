#!/usr/bin/env python3
"""
Sync Chapter 0 body from coordination-papers-mega-volume-chapter-0.tex
into the standalone twins:
  website-v2/public/whitepaper/chapter-0-prerequisites.tex
  whitepaper/chapter-0-prerequisites.tex
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

mega_ch0_path = REPO_ROOT / "website-v2/public/whitepaper/coordination-papers-mega-volume-chapter-0.tex"
twin_paths = [
    REPO_ROOT / "website-v2/public/whitepaper/chapter-0-prerequisites.tex",
    REPO_ROOT / "whitepaper/chapter-0-prerequisites.tex",
]

mega_lines = mega_ch0_path.read_text(encoding="utf-8").splitlines(keepends=True)

# Find start line: \noindent\emph{Express lane:
start_idx = None
for i, line in enumerate(mega_lines):
    if line.startswith(r"\noindent\emph{Express lane:"):
        start_idx = i
        break

if start_idx is None:
    sys.exit("Error: Could not find express lane start in mega-volume-chapter-0.tex")

# Find end line: \end{itemize} right before \pdchapterhandoffprereq
end_idx = None
for i in range(len(mega_lines) - 1, -1, -1):
    if mega_lines[i].strip() == r"\end{itemize}":
        end_idx = i
        break

if end_idx is None:
    sys.exit("Error: Could not find end of chapter map in mega-volume-chapter-0.tex")

chapter_body = "".join(mega_lines[start_idx : end_idx + 1])

for twin_path in twin_paths:
    twin_text = twin_path.read_text(encoding="utf-8")
    
    # Locate preamble section to update
    preamble_target = r"\input{figures/pd-figure-language}"
    preamble_replacement = (
        r"\input{figures/pd-figure-language}" + "\n" +
        r"\input{figures/pd-figure-language-swiss}" + "\n" +
        r"\input{figures/pd-swiss-evidence}" + "\n\n" +
        r"\newtheorem{definition}{Definition}[section]"
    )
    
    if r"\input{figures/pd-figure-language-swiss}" not in twin_text:
        twin_text = twin_text.replace(preamble_target, preamble_replacement, 1)
        
    twin_lines = twin_text.splitlines(keepends=True)
    
    t_start = None
    for i, line in enumerate(twin_lines):
        if line.startswith(r"\noindent\emph{Express lane:"):
            t_start = i
            break
            
    t_end = None
    for i, line in enumerate(twin_lines):
        if line.strip() == r"\bibliographystyle{plain}":
            # the \end{itemize} is right before this
            for j in range(i - 1, -1, -1):
                if twin_lines[j].strip() == r"\end{itemize}":
                    t_end = j
                    break
            break
            
    if t_start is None or t_end is None:
        sys.exit(f"Error: Could not find markers in {twin_path}")
        
    new_twin_text = "".join(twin_lines[:t_start]) + chapter_body + "\n\n" + "".join(twin_lines[t_end + 1 :])
    twin_path.write_text(new_twin_text, encoding="utf-8")
    print(f"Updated {twin_path}")

print("Sync completed successfully.")
