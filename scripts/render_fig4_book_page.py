#!/usr/bin/env python3
"""render_fig4_book_page.py -- Render Figure 0.4 on an authentic Book page.

Uses the exact Book geometry (7in x 10in), Suisse Intl typography,
text column measure (4.5in), margin column (1.3in), and native margin caption.
"""
import os
import sys
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = Path("/Users/erichowens/.gemini/antigravity/brain/7c266e41-224e-46d3-8d23-bb0d02aa8bfc")
WP_DIR = REPO_ROOT / "website-v2/public/whitepaper"
CACHE_BUILD = REPO_ROOT / ".cache/whitepaper-build/coordination-papers-mega-volume"

def render():
    tmp_dir = Path("/tmp/pd_fig4_book_page")
    tmp_dir.mkdir(parents=True, exist_ok=True)
    
    cite_aliases = CACHE_BUILD / "mega-volume-cite-aliases.tex"
    cite_input = f"\\input{{{cite_aliases}}}" if cite_aliases.exists() else ""
    
    tex_source = f"""\\documentclass[11pt,twoside]{{article}}
\\def\\pdedition{{swiss}}
\\newif\\ifpdswiss\\pdswisstrue
\\newif\\ifpdmaritime
\\newif\\ifpdtechnical
\\input{{{WP_DIR}/coordination-papers-mega-volume-preamble.tex}}
\\input{{{WP_DIR}/coordination-papers-mega-volume-seams.tex}}
\\input{{{WP_DIR}/figures/pd-book-citations.tex}}
{cite_input}

\\def\\pdchapref#1#2{{\\emph{{#2}}}}
\\def\\pdcite#1{{[Bainbridge, 1983]}}
\\renewcommand{{\\thefigure}}{{0.4}}

\\pagestyle{{fancy}}
\\fancyhf{{}}
\\fancyhead[LE]{{\\small\\sffamily\\thepage\\quad\\textbf{{Chapter 0. Foundations and Prerequisites}}}}
\\fancyhead[RO]{{\\small\\sffamily\\textbf{{Proposition 4. Attention and Supervision}}\\quad\\thepage}}
\\renewcommand{{\\headrulewidth}}{{0.4pt}}

\\begin{{document}}
\\setcounter{{page}}{{7}}

\\subsubsection*{{Proposition 4: Supervision Has an Information Cost (Attention and Supervision)}}
Human oversight is constrained by fundamental cognitive and information-theoretic limits. As Bainbridge observed in \\emph{{Ironies of Automation}}~[Bainbridge, 1983], automating routine operations does not eliminate human responsibility; it concentrates attention on rare, high-consequence failure modes. A human operator cannot parse a raw firehose of millions of agent telemetry tokens without suffering cognitive saturation and supervisory fatigue.

Yet naive LLM-generated summaries are actively dangerous: they hallucinate away subtle test failures, sanitize errors, and declare false victories. A digest cannot guarantee that a supervisor will notice any one of many relevant events unless it expends sufficient bits and attention to distinguish them. In an accountable architecture, a summary is therefore an index into evidence, not a substitute for it. The supervisory dashboard presents low-entropy summaries backed by cryptographic pointers directly into the underlying Merkle event log, allowing instant drilling down from high-level status to raw syscall traces.

\\begin{{figure}}[htbp]
  \\centering
  \\input{{{WP_DIR}/figures/fig-spark-prop4-supervision.tex}}%
  \\caption{{\\textbf{{Proposition 4 Mechanics: Information Cost and Evidence Drilling.}} Supervisory digests operate as reversible, low-entropy projections indexed into an immutable Merkle evidence log. An operator can drill down with zero friction from high-level fleet status down to exact execution receipts and byte-level syscall traces.}}\\label{{fig:spark-prop4}}
\\end{{figure}}

Let $H(X)$ be the entropy of the agent's raw execution trajectory and let $D$ be a compressed supervisory digest. By the Data Processing Inequality, $I(X; Y) \\le H(D) \\ll H(X)$, meaning information is unavoidably lost in any summary. To prevent supervisory blindness, the kernel constructs digests not as narrative text, but as a directed acyclic graph of cryptographic content digests $\\mathcal{{H}}(e_i)$. The operator inspects a bounded view of complexity $O(\\log N)$, with mathematical guarantees that any contested claim links directly to its underlying execution receipt $\\rho_i$.

\\end{{document}}
"""
    
    tex_file = tmp_dir / "fig4_book_page.tex"
    tex_file.write_text(tex_source, encoding="utf-8")
    
    env = os.environ.copy()
    font_dir = "/Users/erichowens/coding/tmp/book-private-fonts/suisse-intl-20260918/Suisse Intl/OTF/"
    env["PD_BOOK_FONT_DIR"] = font_dir
    env["TEXINPUTS"] = f"{CACHE_BUILD}:{WP_DIR}:{WP_DIR}/figures:{tmp_dir}:"
    
    font_config = tmp_dir / "pd-book-font-config.tex"
    font_config.write_text(f"""\\def\\pdbookfontprofile{{suisse}}
\\edef\\pdbookfontdir{{\\detokenize{{{font_dir}}}}}
""", encoding="utf-8")

    cmd = ["xelatex", "-interaction=nonstopmode", "-halt-on-error", f"-output-directory={tmp_dir}", str(tex_file)]
    res = subprocess.run(cmd, cwd=WP_DIR, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    
    pdf_path = tmp_dir / "fig4_book_page.pdf"
    if not pdf_path.exists():
        print(f"Compilation failed:\n{res.stdout[-3000:]}", file=sys.stderr)
        sys.exit(1)
        
    png_base = ARTIFACT_DIR / "book_page_prop4_v24"
    render_cmd = ["pdftoppm", "-png", "-r", "200", str(pdf_path), str(png_base)]
    subprocess.run(render_cmd, check=True)
    
    pngs = sorted(ARTIFACT_DIR.glob("book_page_prop4_v24*.png"))
    print(f"SUCCESS: Rendered {len(pngs)} authentic book page image(s):")
    for p in pngs:
        print(f"  {p}")

if __name__ == "__main__":
    render()
