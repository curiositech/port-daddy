#!/usr/bin/env python3
"""build_corpus_audit.py -- regenerate references/corpus-audit.md.

Walks the three figure corpora, and for every fragment: finds what document(s)
`\\input` it, extracts its `\\label` and caption first sentence, guesses a
figure kind from structural keywords, runs tikz_precheck.py, compiles it with
compile_fragment.sh, and (if it compiled) runs figcheck.py on the result.
Writes one markdown table plus a totals section.

This is the deterministic inventory build step for the harbor-chartwork
skill: it makes no claim about which figures are well-designed, only what is
mechanically true about each fragment today.

Usage:
  build_corpus_audit.py [--out PATH] [--cache-dir DIR] [--skip-compile]

Compiled PDFs/logs are written under --cache-dir (default: <repo>/.cache/
chartwork/compiled/), which is gitignored -- never committed.
"""
import argparse
import importlib.util
import re
import subprocess
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent


def find_repo_root(start):
    p = start
    for _ in range(10):
        if (p / ".git").exists():
            return p
        p = p.parent
    raise RuntimeError("could not find repo root (no .git found above " + str(start) + ")")


REPO_ROOT = find_repo_root(SCRIPT_DIR)


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


tikz_precheck = load_module("tikz_precheck", SCRIPT_DIR / "tikz_precheck.py")
figcheck = load_module("figcheck", SCRIPT_DIR / "figcheck.py")

CORPORA = [
    {
        "label": "website-v2",
        "dir": REPO_ROOT / "website-v2/public/whitepaper/figures",
        "style_files": {"pd-figure-language.tex", "pd-palette.tex"},
    },
    {
        "label": "whitepaper",
        "dir": REPO_ROOT / "whitepaper/figures",
        "style_files": {"pd-figure-language.tex", "pd-palette.tex"},
    },
    {
        "label": "harbor-research",
        "dir": REPO_ROOT / "docs/harbor-research/figures",
        "style_files": set(),
    },
]


def find_inputters(fragment_path, corpus_label):
    """Return a sorted list of repo-relative paths that `\\input` this
    fragment, searched against the real candidate root documents for its
    corpus (falling back to a repo-wide grep if that comes up empty, so a
    surprise -- a fragment nobody inputs -- is reported honestly rather than
    hidden by too narrow a search)."""
    stem = fragment_path.stem
    parent = fragment_path.parent.parent  # the corpus root that holds figures/

    if corpus_label == "harbor-research":
        # Not just paper*.tex: exec1.tex/exec2.tex/exec3.tex each `\input`
        # exactly one figure too (fig-a7-floor, fig-b1-frontier, fig-b2-tower
        # respectively) -- discovered because the narrower glob silently
        # missed them. doc1-4_*.tex/portfolio.tex/review.tex reference none,
        # so searching the whole dir costs nothing and misses nothing.
        candidates = sorted((parent / "tex").glob("*.tex"))
        patterns = [rf"\\input\{{{re.escape(stem)}\.tex\}}", rf"\\input\{{{re.escape(stem)}\}}"]
    else:
        candidates = sorted(parent.glob("*.tex"))
        patterns = [
            rf"\\input\{{figures/{re.escape(stem)}\}}",
            rf"\\input\{{figures/{re.escape(stem)}\.tex\}}",
        ]

    hits = []
    for cand in candidates:
        text = cand.read_text(encoding="utf-8", errors="replace")
        if any(re.search(pat, text) for pat in patterns):
            hits.append(cand.relative_to(REPO_ROOT).as_posix())

    if hits:
        return sorted(hits)

    # Fall back to a repo-wide search in case the real inputter lives
    # somewhere this corpus's usual root-document set doesn't cover.
    wide_hits = []
    for tex_file in REPO_ROOT.rglob("*.tex"):
        if "figures" in tex_file.parts:
            continue
        if ".cache" in tex_file.parts or "node_modules" in tex_file.parts:
            continue
        try:
            text = tex_file.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if any(re.search(pat, text) for pat in patterns):
            wide_hits.append(tex_file.relative_to(REPO_ROOT).as_posix())
    return sorted(wide_hits)


LABEL_RE = re.compile(r"\\label\{([^}]*)\}")


def find_label(text):
    m = LABEL_RE.search(text)
    return m.group(1) if m else None


def find_caption_first_sentence(text):
    idx = text.find("\\caption{")
    if idx == -1:
        return None
    body, _ = tikz_precheck.find_braced(text, idx + len("\\caption{") - 1)
    bm = re.match(r"^\s*\\textbf\{", body)
    if bm:
        inner, rest_start = tikz_precheck.find_braced(body, bm.end() - 1)
        remainder = body[rest_start:]
        combined = inner.strip().rstrip(".") + ". " + remainder.strip()
    else:
        combined = body
    # de-TeX lightly for a readable one-line summary
    plain = re.sub(r"\\label\{[^}]*\}", "", combined)
    plain = re.sub(r"\$[^$]*\$", " ", plain)
    plain = re.sub(r"\\(?:textbf|textit|emph|texttt|textsc)\{([^{}]*)\}", r"\1", plain)
    plain = re.sub(r"\\[A-Za-z]+\*?", " ", plain)
    plain = re.sub(r"[{}]", "", plain)
    plain = re.sub(r"\s+", " ", plain).strip()
    m = re.search(r"^(.*?[.!?])(\s|$)", plain)
    sentence = m.group(1) if m else plain
    return sentence[:220]


def guess_figure_kind(text):
    """Mechanical best guess from structural keywords -- not a design
    judgment. First matching rule wins; see the module docstring."""
    if "\\begin{axis}" in text or "\\pdfigaxis" in text or "\\pdfigvaxis" in text:
        return "regime diagram"
    if "\\begin{tabular}" in text or "matrix of nodes" in text:
        return "table-like"
    if len(re.findall(r"\bpd state\b|\bpd terminal\b", text)) >= 2:
        return "state machine"
    if len(re.findall(r"\bpd actor\b", text)) >= 2:
        return "ladder"
    if re.search(r"\\foreach\s*\\x\s+in", text) and not re.search(r"\\foreach\s*\\y\s+in", text):
        return "timeline"
    if "\\node" in text and ("\\draw" in text or "\\path" in text):
        return "relation map"
    return "other"


def summarize_precheck(report):
    hard = [f["check"] for f in report["findings"] if f["severity"] == "fail"]
    warn = [f["check"] for f in report["findings"] if f["severity"] == "warn"]
    if not hard and not warn:
        return "pass"
    parts = []
    if hard:
        from collections import Counter

        counts = Counter(hard)
        parts.append("fail: " + ", ".join(f"{c}\u00d7{n}" for c, n in sorted(counts.items())))
    if warn:
        from collections import Counter

        counts = Counter(warn)
        parts.append("warn: " + ", ".join(f"{c}\u00d7{n}" for c, n in sorted(counts.items())))
    return "; ".join(parts)


def summarize_figcheck(report):
    from collections import Counter

    hard = Counter()
    warn = Counter()
    for c, chk in report["checks"].items():
        if chk["status"] == "fail":
            hard[c] = chk["count"]
        elif chk["status"] == "warn":
            warn[c] = chk["count"]
    if not hard and not warn:
        return "pass"
    parts = []
    if hard:
        parts.append("fail: " + ", ".join(f"{c}\u00d7{n}" for c, n in sorted(hard.items())))
    if warn:
        parts.append("warn: " + ", ".join(f"{c}\u00d7{n}" for c, n in sorted(warn.items())))
    return "; ".join(parts)


def compile_one(fragment_path, out_dir, timeout=90):
    cmd = [
        "bash",
        str(SCRIPT_DIR / "compile_fragment.sh"),
        str(fragment_path),
        "--out",
        str(out_dir),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return False, None, f"compile timed out after {timeout}s"
    pdf_path = out_dir / (fragment_path.stem + ".pdf")
    if proc.returncode == 0 and pdf_path.is_file():
        return True, pdf_path, None
    # compile_fragment.sh's own stderr contract is: one "FAILED to compile ..."
    # summary line, then the actual first TeX error (or a log tail) below it --
    # skip the summary line so the audit records the real error, not the
    # generic wrapper message repeated on every row.
    err_lines = [l for l in (proc.stderr or proc.stdout or "").splitlines() if l.strip()]
    err_lines = [l for l in err_lines if not l.startswith("compile_fragment.sh: FAILED")]
    first_err = err_lines[0] if err_lines else "(no error output captured)"
    return False, None, first_err[:200]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(REPO_ROOT / "skills/harbor-chartwork/references/corpus-audit.md"))
    ap.add_argument("--cache-dir", default=str(REPO_ROOT / ".cache/chartwork/compiled"))
    ap.add_argument("--skip-compile", action="store_true", help="skip compile+figcheck (precheck only, fast)")
    args = ap.parse_args(argv)

    cache_dir = Path(args.cache_dir)
    rows = []
    t0 = time.time()

    from collections import Counter

    pre_hard_occurrences = Counter()
    pre_hard_files = {}  # check -> set(file)
    fig_hard_occurrences = Counter()
    fig_hard_files = {}
    fig_warn_occurrences = Counter()
    fig_warn_files = {}

    for corpus in CORPORA:
        fragments = sorted(
            p for p in corpus["dir"].glob("*.tex") if p.name not in corpus["style_files"]
        )
        for i, frag in enumerate(fragments):
            text = frag.read_text(encoding="utf-8", errors="replace")
            rel = frag.relative_to(REPO_ROOT).as_posix()
            print(f"[{corpus['label']} {i + 1}/{len(fragments)}] {rel}", file=sys.stderr)

            inputters = find_inputters(frag, corpus["label"])
            label = find_label(text)
            caption = find_caption_first_sentence(text)
            kind = guess_figure_kind(text)
            pre_report = tikz_precheck.run_precheck(str(frag), corpus="auto")
            pre_summary = summarize_precheck(pre_report)
            for f in pre_report["findings"]:
                if f["severity"] != "fail":
                    continue
                pre_hard_occurrences[f["check"]] += 1
                pre_hard_files.setdefault(f["check"], set()).add(rel)

            compiles = None
            compile_err = None
            fig_summary = None
            if not args.skip_compile:
                out_dir = cache_dir / corpus["label"] / frag.stem
                ok, pdf_path, err = compile_one(frag, out_dir)
                compiles = ok
                if ok:
                    try:
                        fig_report = figcheck.run_figcheck(pdf_path)
                        fig_summary = summarize_figcheck(fig_report)
                        for c, chk in fig_report["checks"].items():
                            if chk["status"] == "fail":
                                fig_hard_occurrences[c] += chk["count"]
                                fig_hard_files.setdefault(c, set()).add(rel)
                            elif chk["status"] == "warn":
                                fig_warn_occurrences[c] += chk["count"]
                                fig_warn_files.setdefault(c, set()).add(rel)
                    except Exception as exc:  # noqa: BLE001
                        fig_summary = f"figcheck error: {exc}"
                else:
                    compile_err = err

            rows.append(
                {
                    "file": rel,
                    "corpus": corpus["label"],
                    "inputters": inputters,
                    "label": label,
                    "kind": kind,
                    "caption": caption,
                    "precheck": pre_summary,
                    "precheck_corpus": pre_report["corpus"],
                    "compiles": compiles,
                    "compile_err": compile_err,
                    "figcheck": fig_summary,
                }
            )

    totals = {
        "pre_hard_occurrences": pre_hard_occurrences,
        "pre_hard_files": pre_hard_files,
        "fig_hard_occurrences": fig_hard_occurrences,
        "fig_hard_files": fig_hard_files,
        "fig_warn_occurrences": fig_warn_occurrences,
        "fig_warn_files": fig_warn_files,
    }
    render_report(rows, Path(args.out), args.skip_compile, time.time() - t0, totals)


def render_report(rows, out_path, skip_compile, elapsed_s, totals):
    lines = []
    lines.append("# Corpus audit")
    lines.append("")
    lines.append(
        "Deterministic inventory of every TikZ figure fragment across the three "
        "corpora, generated by `scripts/build_corpus_audit.py` -- re-run that "
        "script to refresh this file after any figure changes. This is a "
        "mechanical record (what `\\input`s what, what compiles, what the "
        "checkers found), not a design review: `figure kind` is a best-guess "
        "from structural keywords (see `guess_figure_kind()`), and a precheck "
        "or figcheck finding is a fact about the fragment's source/geometry, "
        "not a verdict on whether the figure is well designed."
    )
    lines.append("")
    lines.append(f"Generated in {elapsed_s:.0f}s. Compiled PDFs live under `.cache/chartwork/` "
                 f"(gitignored, not part of this commit).")
    if skip_compile:
        lines.append("")
        lines.append("**Note:** built with `--skip-compile` -- the Compiles/Figcheck columns were not run.")
    lines.append("")
    lines.append(
        "| File | Corpus | Input by | Label | Kind | Caption (first sentence) | "
        "Precheck | Compiles | Figcheck |"
    )
    lines.append("|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        inputters = "<br>".join(f"`{p}`" for p in r["inputters"]) if r["inputters"] else "*(none found)*"
        label = f"`{r['label']}`" if r["label"] else "none"
        caption = (r["caption"] or "none").replace("|", "\\|")
        precheck = r["precheck"].replace("|", "\\|")
        if r["compiles"] is None:
            compiles_cell = "n/a"
        elif r["compiles"]:
            compiles_cell = "pass"
        else:
            err = (r["compile_err"] or "").replace("|", "\\|").replace("\n", " ")
            compiles_cell = f"**FAIL** -- {err}"
        figcheck_cell = (r["figcheck"] or "n/a").replace("|", "\\|")
        lines.append(
            f"| `{r['file']}` | {r['corpus']} | {inputters} | {label} | {r['kind']} | "
            f"{caption} | {precheck} | {compiles_cell} | {figcheck_cell} |"
        )

    lines.append("")
    lines.append("## Totals")
    lines.append("")

    from collections import Counter

    by_corpus = Counter(r["corpus"] for r in rows)
    lines.append("### Fragments by corpus")
    lines.append("")
    lines.append("| Corpus | Fragments |")
    lines.append("|---|---|")
    for c, n in sorted(by_corpus.items()):
        lines.append(f"| {c} | {n} |")
    lines.append(f"| **Total** | **{len(rows)}** |")
    lines.append("")

    orphans = [r for r in rows if not r["inputters"]]
    lines.append(f"### Fragments with no `\\input`er found ({len(orphans)})")
    lines.append("")
    lines.append(
        "Searched against every root document in the fragment's own corpus, then "
        "(if that came up empty) every `.tex` file in the repo outside a `figures/` "
        "directory. A fragment listed here is not reachable from any compiled "
        "chapter or paper today -- it may be superseded, mid-refactor, or simply "
        "dead; this table does not judge which."
    )
    lines.append("")
    if orphans:
        for r in orphans:
            lines.append(f"- `{r['file']}`")
    else:
        lines.append("*(none)*")
    lines.append("")

    if not skip_compile:
        compiled = [r for r in rows if r["compiles"]]
        failed = [r for r in rows if r["compiles"] is False]
        lines.append("### Compile pass/fail")
        lines.append("")
        lines.append("| Corpus | Pass | Fail |")
        lines.append("|---|---|---|")
        for c in sorted(by_corpus):
            p = sum(1 for r in compiled if r["corpus"] == c)
            f = sum(1 for r in failed if r["corpus"] == c)
            lines.append(f"| {c} | {p} | {f} |")
        lines.append(f"| **Total** | **{len(compiled)}** | **{len(failed)}** |")
        lines.append("")
        if failed:
            lines.append("Fragments that failed to compile standalone:")
            lines.append("")
            for r in failed:
                lines.append(f"- `{r['file']}`: {r['compile_err']}")
            lines.append("")

    lines.append("### tikz_precheck hard-finding counts by check")
    lines.append("")
    lines.append("| Check | Occurrences | Fragments affected |")
    lines.append("|---|---|---|")
    check_names = ["provenance", "tiny", "color", "node-wrap", "title-number"]
    for name in check_names:
        occ = totals["pre_hard_occurrences"].get(name, 0)
        nfiles = len(totals["pre_hard_files"].get(name, ()))
        lines.append(f"| {name} | {occ} | {nfiles} |")
    lines.append("")

    if not skip_compile:
        lines.append("### figcheck finding counts (fragments that compiled)")
        lines.append("")
        lines.append("| Check | Hard occurrences | Hard fragments | Warn occurrences | Warn fragments |")
        lines.append("|---|---|---|---|---|")
        for c in figcheck.ALL_CHECKS:
            h_occ = totals["fig_hard_occurrences"].get(c, 0)
            h_files = len(totals["fig_hard_files"].get(c, ()))
            w_occ = totals["fig_warn_occurrences"].get(c, 0)
            w_files = len(totals["fig_warn_files"].get(c, ()))
            lines.append(f"| {c} | {h_occ} | {h_files} | {w_occ} | {w_files} |")
        lines.append("")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines) + "\n")
    print(f"wrote {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
