# Research notes and sources

This skill uses a task-first process because visualization design errors
cascade: an attractive encoding cannot repair an incorrect task/data
abstraction. It uses visual grammar selection because a presentation must first
be expressive (say the right thing) and then effective (make the right
comparison easy). It prioritizes position and aligned length for quantitative
comparison because graphical-perception studies establish a hierarchy among
common encodings. These are design heuristics, not a claim that one chart type
fits every audience or dataset.

1. Tamara Munzner, [A Nested Model for Visualization Design and Validation](https://vis.csail.mit.edu/classes/6.859/readings/pdfs/Munzner-ANestedModelForVisualizationDesignAndValidation.pdf), *IEEE TVCG* 15(6), 2009. Four cascading levels: domain problem, data/task abstraction, visual encoding/interaction, algorithm.
2. Jock D. Mackinlay, [Automating the Design of Graphical Presentations of Relational Information](https://courses.ischool.berkeley.edu/i247/f05/readings/Mackinlay_APT_TOG86.pdf), *ACM TOG* 5(2), 1986. Formalizes expressiveness and effectiveness criteria for graphical languages.
3. William S. Cleveland and Robert McGill, [Graphical Perception: Theory, Experimentation, and Application to the Development of Graphical Methods](https://faculty.washington.edu/aragon/classes/hcde411/w13/readings/cleveland84.pdf), *JASA* 79(387), 1984. Experimental basis for prioritizing position and length over less accurate encodings.
4. Jeffrey Heer and Michael Bostock, [Crowdsourcing Graphical Perception](https://idl.uw.edu/papers/crowdsourcing-graphical-perception), *CHI*, 2010. Replicates graphical-perception results and examines area, chart size, and gridline spacing.
5. Financial Times Visual Journalism Team, [Visual Vocabulary](https://github.com/Financial-Times/chart-doctor/blob/main/visual-vocabulary/README.md). Practical task-to-chart selection and editorial cautions.
6. PGF/TikZ Team, [PGF package and manual](https://ctan.org/pkg/pgf), official CTAN distribution. TikZ is the user-facing drawing layer over PGF.
7. Christian Feuersänger, [PGFPlots Manual](https://mirrors.ctan.org/graphics/pgf/contrib/pgfplots/doc/pgfplots.pdf), v1.18.1. Axis/plot features including error bars, histograms, areas, and contour plots.
8. W3C, [Contrast (Minimum), WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Digital contrast reference; use as a baseline for labels and do not rely on hue alone.

## What this evidence changes in practice

- A paper figure starts with the question and the evidence type, not a favored
  TikZ idiom.
- Quantitative claims get scales; protocol claims get order/guards; evidence
  claims get traceability; containment claims get scope.
- Rendered inspection is mandatory because source-level correctness cannot show
  cropping, font-size failure, optical imbalance, or collision.

