# Source boundary and fixture contract

## Primary source access

- Hansen, J. and Ghrist, R., [*Toward a Spectral Theory of Cellular Sheaves*](https://arxiv.org/abs/1808.01513), arXiv:1808.01513v2 (2019), DOI `10.1007/s41468-019-00038-7`. On 2026-09-24, the arXiv version record and author-hosted PDF were opened. Targeted body access covered Definitions 2.4–2.5, §2.2.2, §§3.1–3.2, including Theorem 3.1; the complete 46-page body was not reviewed and no rendered PDF-page inspection is claimed.
- The source supports cellular restriction maps, their composition, coboundary construction, and finite-dimensional inner-product Hodge theory under its stated hypotheses. It does not support a universal agent diagnostic, causal explanation, or runtime authorization rule.

## Local constructions

The scalar triangle, path/tree rank calculation, unweighted effective-resistance identity, numerical tolerance, and fixture data are local, finite constructions. They are intended to catch matrix/sign/model mistakes. They do not prove that any external observation was independently measured or that a model residual identifies a cause.

## Fixture boundaries

`examples/triadic-cochain-solve.py` and the receipt fixture check:

1. `delta1 delta0=0` for the stated triangle orientation.
2. Reconstruction and Euclidean orthogonality of the displayed numerical split.
3. Filled versus unfilled face behavior for the same `g=(0,3,0)`.
4. Zero residual as an undefined energy fraction.
5. Finite input and dimension validation, plus transformed orientation coordinates.
6. The constant-scalar rank and one-edge sensitivity formula under their explicit hypotheses.

They do not validate a production telemetry source, a threat model, an authorization path, or a claim about agent behavior.

The root review additionally checks both solvers on 54 filled/unfilled grid cases, rejects invalid topology flags/tolerances and computed overflow, tests the weighted-adjoint identity, and checks the one-edge zero-map sheaf counterexample. NumPy 2.3.5 was present during these checks; none of the NumPy cases were silently skipped. The executable uses a relative reconstruction threshold, normalized orthogonality checks, and an absolute residual-norm threshold for the descriptive energy fraction; changing units requires reconsidering that threshold.
