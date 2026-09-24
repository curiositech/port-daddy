# Conditional statistical methods

This is a method-selection aid, not an automatic router. Write the estimand and assignment mechanism first. The methods below assume the stated units and observations; repeated messages, retries, or ratings do not become independent observations by being stored in separate rows.

## Mean contrasts

For two independent groups with group means, variances and sizes, a Welch statistic for a null difference `delta0` is:

```math
t = (mean_A - mean_B - delta0) / sqrt(s_A^2/n_A + s_B^2/n_B)
```

Use the Welch-Satterthwaite degrees of freedom and an interval for that mean contrast. Unequal variances are allowed; arbitrary within-group dependence is not. For paired observations, work with the differences `D_i = A_i - B_i` and use `mean(D)/(s_D/sqrt(n))` for a zero mean-difference null when the paired-t assumptions are defensible. The variance of the differences, not the two marginal variances treated as independent, drives precision. [NIST two-sample t-test reference](https://www.itl.nist.gov/div898/handbook/eda/section3/eda353.htm), formula and pairing discussion accessed 2026-09-24.

## Rank and randomization approaches

Wilcoxon signed-rank inference for paired differences requires its symmetry/location interpretation; it is not an assumption-free substitute for a paired mean test. Mann-Whitney/Wilcoxon rank-sum applies to independent groups; interpreting it as a difference in medians requires additional distributional structure. The reported two-sample location estimator is not generally the difference of sample medians. Ties, discrete outcomes and small samples affect the inferential calculation. [Official R Wilcoxon documentation](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/wilcox.test.html), Details accessed 2026-09-24.

An assignment-based randomization analysis must reproduce the permitted assignments from the study design. For matched/block-randomized tasks, do not freely shuffle individual messages or observations between all groups. State the null, statistic, permitted assignment set and treatment of missing outcomes. If the assignment mechanism is unknown, calling an arbitrary permutation procedure “exact” does not establish validity.

## A conditional sample-size calculation

For planning **two independent, equally sized groups** with a continuous mean estimand, common standard deviation `sigma`, two-sided alpha and target power `1-beta`, a normal approximation gives:

```math
n_per_group ~= 2 * (z_(1-alpha/2) + z_(1-beta))^2 * sigma^2 / delta^2
```

Constructed example: choose alpha=.05, power=.80, `sigma=100 ms`, and a smallest practically meaningful difference `delta=50 ms`. Using normal quantiles gives about 62.8, rounded up to 63 per group. This is only the stated large-sample approximation; a t-based solution differs, and attrition, pairing or clustering changes the calculation. The values were chosen for illustration, not inferred from agent benchmarks.

[R's power.t.test documentation](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/power.t.test.html) defines distinct two-sample, one-sample and paired calculations, with sample count per group. Use a method matching the actual design and perform sensitivity analysis over plausible variances/event rates. Its default parameters are not recommended research thresholds. API documentation accessed 2026-09-24; this handoff has not executed R.

## Uncertainty and reporting

A confidence interval, a test of no effect, and a decision about practical value answer different questions. Record the resource budget and smallest effect that would change the engineering decision. Report missingness, all declared outcomes, sensitivity to analysis assumptions, and whether results were exploratory. When independence or sampling assumptions cannot be defended, descriptive per-unit results and a narrower claim are more informative than a spurious interval.
