# Source, scope, and access record

Research source: architecture-B02-identity-infrastructure-deepening.md, SHA
704422a75e592eda5cb3cef166b1cf8dcdb3675fe2fcef22e822de536a223577,
read 2026-09-24. The cited primary materials were inspected at the access depth
recorded in that research document.

- [NIST SP 800-63-4, final July 2025](https://pages.nist.gov/800-63-4/sp800-63.html):
  IAL proofing/enrollment, AAL authentication, and FAL federation vocabulary.
  It concerns people and government information systems; it does not prove a
  complete agent protocol, unique agenthood, or continuity of behavior.
- [Douceur 2002](https://users.ece.cmu.edu/~adrian/731-sp04/readings/Douceur-sybil.pdf):
  a credential alone is not global Sybil resistance. State issuer namespace,
  enrollment, recovery, revocation, and duplicate-registration threat model.
- [Friedman and Resnick 2001](https://gwern.net/doc/economics/mechanism-design/2001-friedman.pdf):
  entry fees, dues, and unreplaceable pseudonyms have participation/reset
  tradeoffs; no universal newcomer policy follows.
- [TrueSkill 2006](https://proceedings.neurips.cc/paper/2006/file/f44ee263952e65b3610b8ba51229d1f9-Paper.pdf):
  posterior uncertainty is conditional on model, prior, and outcomes. It is not
  empirical calibration without held-out evaluation.
- [Zheng et al. 2023](https://arxiv.org/abs/2306.05685):
  order swap handles a position-bias check for its evaluation setting. It does
  not by itself cure verbosity or self-preference bias.

The offline auditor validates a supplied JSON declaration and names declared
inconsistencies. It does not fetch receipts, authenticate keys, observe delivery,
verify signatures, or execute an enforcement mechanism.
