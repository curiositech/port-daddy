#!/usr/bin/env python3
"""preview_figure.py -- compile one TikZ figure fragment standalone and generate high-res PNG.

Runs xelatex with the real Book preamble and fonts, producing an immediate PNG in the artifact directory.
Usage:
    python3 scripts/preview_figure.py website-v2/public/whitepaper/figures/fig-whatever.tex [output_name]
    python3 scripts/preview_figure.py --snippet "path/to/snippet.tex" [output_name]
"""
import os
import sys
import subprocess
import shutil
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = Path("/Users/erichowens/.gemini/antigravity/brain/7c266e41-224e-46d3-8d23-bb0d02aa8bfc")
WP_DIR = REPO_ROOT / "website-v2/public/whitepaper"
CACHE_BUILD = REPO_ROOT / ".cache/whitepaper-build/coordination-papers-mega-volume"

def preview(frag_path, out_name=None, width_cm=16.5):
    frag = Path(frag_path).resolve()
    if not frag.exists():
        print(f"Error: {frag} does not exist", file=sys.stderr)
        sys.exit(1)
        
    stem = out_name or frag.stem
    tmp_dir = Path(f"/tmp/pd_preview_{stem}")
    tmp_dir.mkdir(parents=True, exist_ok=True)
    
    # Read fragment
    frag_content = frag.read_text(encoding="utf-8")
    
    # Determine if it's already a complete tikzpicture or needs a figure environment
    has_begin_doc = r"\begin{document}" in frag_content
    
    if has_begin_doc:
        tex_source = frag_content
    else:
        # Wrap in minimal Book environment
        tex_source = f"""\\documentclass[11pt,a4paper,twoside]{{article}}
\\def\\pdedition{{swiss}}
\\newif\\ifpdswiss\\pdswisstrue
\\newif\\ifpdmaritime
\\input{{{WP_DIR}/coordination-papers-mega-volume-preamble.tex}}
\\geometry{{paperwidth=26cm,paperheight=34cm,margin=1.5cm}}
\\input{{{WP_DIR}/coordination-papers-mega-volume-seams.tex}}
\\input{{{WP_DIR}/figures/pd-book-citations.tex}}
\\providecommand{{\\pdreaderleftprose}}{{\\small [Reader Left Prose Placeholder]}}
\\providecommand{{\\pdreaderrightprose}}{{\\small [Reader Right Prose Placeholder]}}
\\begin{{document}}
\\thispagestyle{{empty}}
\\begin{{center}}
{frag_content}
\\end{{center}}
\\end{{document}}
"""
    
    wrapper_tex = tmp_dir / f"{stem}.tex"
    wrapper_tex.write_text(tex_source, encoding="utf-8")
    
    # Prepare environment
    env = os.environ.copy()
    font_dir = "/Users/erichowens/coding/tmp/book-private-fonts/suisse-intl-20260918/Suisse Intl/OTF/"
    env["PD_BOOK_FONT_DIR"] = font_dir
    texinputs = f"{CACHE_BUILD}:{WP_DIR}:{WP_DIR}/figures:{tmp_dir}:"
    env["TEXINPUTS"] = texinputs
    
    # Ensure pd-book-font-config.tex exists in tmp_dir
    font_config = tmp_dir / "pd-book-font-config.tex"
    font_config.write_text(f"""\\def\\pdbookfontprofile{{suisse}}
\\edef\\pdbookfontdir{{\\detokenize{{{font_dir}}}}}
""", encoding="utf-8")
    
    # Run xelatex
    cmd = ["xelatex", "-interaction=nonstopmode", "-halt-on-error", f"-output-directory={tmp_dir}", str(wrapper_tex)]
    res = subprocess.run(cmd, cwd=WP_DIR, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    
    pdf_path = tmp_dir / f"{stem}.pdf"
    if not pdf_path.exists():
        print(f"Compilation failed:\n{res.stdout[-2000:]}", file=sys.stderr)
        sys.exit(1)
        
    # Render PNG
    png_base = ARTIFACT_DIR / f"preview_{stem}"
    render_cmd = ["pdftoppm", "-png", "-r", "150", str(pdf_path), str(png_base)]
    subprocess.run(render_cmd, check=True)
    
    # Find generated png
    pngs = sorted(ARTIFACT_DIR.glob(f"preview_{stem}*.png"))
    print(f"SUCCESS: Generated {len(pngs)} preview image(s):")
    for p in pngs:
        print(f"  {p}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/preview_figure.py <fragment.tex> [output_name]")
        sys.exit(1)
    out_name = sys.argv[2] if len(sys.argv) > 2 else None
    preview(sys.argv[1], out_name)
