# Threat model and source ledger

## Required threat-model questions

1. What assets, authority, evidence, attention, time, reputation, and external systems are reachable?
2. Who controls each key, store, process, identity, witness, oracle, and appeal?
3. Which parties can collude or share a hidden principal?
4. What information is visible before commitment, execution, adjudication, or settlement?
5. What losses are bounded, recoverable, insured, externalized, or unknown?
6. What happens under crash, duplicate, reorder, lost acknowledgement, insolvency, mass exit, and permanent dispute?
7. Which defense assumption would make the attack profitable if false?

## Primary source ledger

- John R. Douceur, “The Sybil Attack” (IPTPS 2002): without a logically centralized identity authority, distinguishing independent remote entities requires strong assumptions. <https://www.microsoft.com/en-us/research/publication/the-sybil-attack/>
- Philip Daian et al., “Flash Boys 2.0” (IEEE S&P 2020): ordering dependence and privileged inclusion create extractable value and broader system risk. <https://arxiv.org/abs/1904.05234>
- Ethereum proof-of-stake rewards and penalties: slashing is behavior-specific and correlation-sensitive; it is not a general work-quality oracle. <https://ethereum.org/developers/docs/consensus-mechanisms/pos/rewards-and-penalties/>
- Steven Shavell, “On the Design of Contracts and Remedies for Breach”: incomplete contracts leave unverifiable contingencies and motivate remedies and renegotiation rather than perfect ex-ante enumeration. <https://www.nber.org/papers/w0727>
- Tilmann Gneiting and Adrian Raftery, “Strictly Proper Scoring Rules, Prediction, and Estimation”: truthfulness properties depend on the forecast, outcome, and utility assumptions of the scoring rule. <https://doi.org/10.1198/016214506000001437>
- NIST SP 800-63-4: identity proofing is risk- and assurance-level based, with security, privacy, equity, and usability tradeoffs. <https://csrc.nist.gov/pubs/sp/800-63/4/2pd>

These sources inform threat questions. They do not establish that a Port Daddy mechanism is implemented, lawful, secure, or deployed.
