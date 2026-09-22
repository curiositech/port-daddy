# Book equilibrium follow-up — 19 September 2026

## Delivery boundary

This is a local manuscript revision and rendered proof, not a published edition. The existing Book worktree and its unrelated edits were preserved; no broad staging or Book commit was performed. The changes are in Chapters 7–8 and the mathematical regression suite. The broader figure redesign and critical-review program remain unfinished.

The Book Evidence Writing skill guided a narrow correction of claims and assumptions rather than an additional survey chapter. A lower-cost native agent independently reviewed the changed passages; the lead checked its conclusions and the rendered pages.

## What changed

- Chapter 7 distinguishes a recommendation from an incentive to obey it. Public policy and authenticated logs do not by themselves establish a probability distribution, private information, or enforceable payoffs.
- The existing repeated-game calculation is retained. The text no longer presents finite punishment as a crash-tolerance result or its threshold as a general folk theorem. Longer finite punishment helps only strictly above the one-third limiting threshold; equality requires perpetual punishment for weak indifference in the specified example.
- Loss of public history invalidates the particular trigger argument, not every possible cooperation mechanism. Identity resets undermine identity-bound sanctions without implying that all future value literally becomes zero.
- Chapter 8 no longer claims that a daemon or signed root automatically produces correlated equilibrium or common knowledge. Its exercise and solution distinguish coarse correlated equilibrium from recommendation-conditioned correlated equilibrium and state the relevant information and utility assumptions.
- Missing cross-harbor evidence calls for deferring the dependent effect while preserving authorized local work and existing obligations. This authorization rule is not presented as an equilibrium proof.
- Two public references replace unsupported shortcuts: Halpern–Moses on knowledge in distributed systems and Farina's equilibrium lecture. Private workshop framing was removed from the touched limitations passage.

Primary references checked:

- [Aumann, Subjectivity and Correlation in Randomized Strategies](https://cris.huji.ac.il/en/publications/subjectivity-and-correlation-in-randomized-strategies/)
- [Farina, Correlated Equilibrium lecture](https://www.mit.edu/~gfarina/2024/6S890f24_L03_nfg_corr/L03.pdf)
- [Halpern and Moses, Knowledge and Common Knowledge in a Distributed Environment](https://groups.csail.mit.edu/tds/papers/Halpern/JACM90.pdf)
- [Fudenberg and Yamamoto, Repeated Games Where the Payoffs and Monitoring Structure Are Unknown](https://economics.mit.edu/sites/default/files/2022-10/repeated_games_where_the_payoffs.pdf)

## Measured effect

| Measure | Before | After |
| --- | ---: | ---: |
| PDF pages | 703 | 704 |
| Collated references | 279 | 281 |
| Chapter 7 source tokens, whitespace-separated | 25,024 | 24,985 |
| Chapter 8 source tokens, whitespace-separated | 20,531 | 20,502 |
| Whitespace candidates requiring judgment | 38 | 39 |

The token counts include TeX and bibliography material; they are not prose word counts. Chapter pagination is unchanged. The extra page is the final references leaf, physical page 702, with three records and substantial lower whitespace. That leaf remains a layout-review candidate; no smaller type or deleted citation was used to conceal it. Credits move to physical pages 703–704.

The illustrated contents, chapter plates, and licensed Suisse typography remain intact. This pass adds no new illustrations.

## Validation and limits

- All 230 numbered captions pass margin-bound checks. Adjacency is checked for 190 recorded floating owners; non-floating tables and listings receive bounds checks only.
- All 896 registered margin objects were placed; no recorded margin collisions, content loss, or footer intrusions were found.
- Twenty width advisories remain for margin art and portraits. Their existence is not evidence that every figure is visually or semantically accepted.
- Mathematical tests: 26 passed. Added examples deliberately reject obedience without incentives and distinguish CCE from CE; the punishment boundary is tested separately.
- Editorial tests: 12 passed. Layout tests: 13 passed. Contents tests: 6 passed. Typography tests: 16 passed. Generator/contents tests: 66 passed.
- Inspected before/after page selections 454, 455, 478, 479, 530, 578, 579, 650, and 651, plus final references and credits. Full-size inspection included the Aumann portrait/equation, revised exercise solution, and new references leaf.
- No unresolved citation or label warning remained. Existing small-caps font-shape warnings are not resolved by this pass.

The local XeLaTeX attempt lacked `xltabular.sty`; no package was installed. The successful proof uses the same cached Tectonic renderer as the preceding local baseline, with the private Suisse files referenced in place. This does not certify the production XeLaTeX or hosted publication path.

## Reproducible artifacts

All paths below are relative to this Book worktree.

- Before sources: `.cache/book-equilibrium-followup-20260919/source-before/`
- Before PDF: `.cache/book-layout-followup-20260919/build/coordination-papers-mega-volume.pdf`
- Before SHA-256: `cbe9a0ab947080ba7dec448912ddc8717a2d7e4b5a90a3f574df408df6281799`
- After PDF: `.cache/book-equilibrium-followup-20260919/build/coordination-papers-mega-volume.pdf`
- After SHA-256: `e757793da8c26142494fa91cff625277f2782f05ef4753beae663ec2ba1a2729`
- Audits: `.cache/book-equilibrium-followup-20260919/{layout,caption,overflow}-audit.json`
- Build log: `.cache/book-equilibrium-followup-20260919/build/compile.log`

Next Book work should address the remaining figure semantics, visual density, and whitespace candidates without treating these bounded automated checks as whole-book design approval.
