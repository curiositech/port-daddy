# Formal Verification Suite for Port Daddy Sheaf Cohomology

This directory contains the formal specifications and automated machine proofs for the cellular sheaf cohomology consensus and repair framework across multi-agent swarms.

## 1. Z3 SMT Solver Automated Proofs (`verify_sheaf_theorems.py`)

Formally verifies the 5 central mathematical theorems of the Port Daddy Sheaf Consensus framework:
- **Theorem CR-1 (Coboundary Nilpotence)**: $\delta_1 \circ \delta_0 \equiv 0$ universally proved via UNSAT refutation over all real 0-cochains.
- **Theorem CR-2 (Algebraic Circulation)**: $B_K^T \rho = 0$ proved symbolically and empirically across random cochain fields ($\|B \rho\|_\infty < 10^{-14}$).
- **Theorem CR-3 (Tree Blindness)**: On any tree/DAG, effective resistance $R_{\text{eff}}(e) = 1 \implies r \equiv 0.000$. OpenTelemetry and LangSmith cannot detect non-acyclic branch equivocations.
- **Theorem CR-4 (Greedy Energy Dissipation)**: Monotonic energy collapse $\Delta E > 0$ strictly proved; finite termination guaranteed in $\le \beta_1$ rounds.
- **Theorem CR-5 (Simplicial Hodge-Helmholtz Orthogonality)**: $\langle \delta_0 x, \delta_1^* \psi \rangle = 0$ universally proved.

### Running Z3:
```bash
python3 formal/verify_sheaf_theorems.py
```

## 2. TLA+ Specification (`SheafConsensusRepair.tla`)

Specifies the state-machine semantics of the 9-agent WebAuthn migration swarm under operator fault injection and greedy cohomological min-cut repair.
- **Invariants Checked**:
  - `TypeOK`: State space validity
  - `NilpotentBoundaryInvariant`: Honest consensus states have zero residual
  - `ResidualCirculationInvariant`: Injected faults produce $r > 0$
  - `FiniteRepairBound`: Terminates within $\beta_1$ rounds

### Running with TLC:
```bash
java -cp formal/tla2tools.jar tlc2.TLC -config formal/SheafConsensusRepair.cfg formal/SheafConsensusRepair.tla
```

## 3. ProVerif Applied Pi-Calculus Model (`sheaf_consensus.pv`)

Models active Dolev-Yao network adversaries attempting to forge AST leases or inject silent branch inconsistencies. Proves:
1. `event(LeaseGranted(a, ep, h)) ==> event(BeginLeaseRequest(a, ep, h))` (Authenticity)
2. `event(SilentInconsistencyCommitted(a1, a2, h1, h2)) ==> false` (Impossibility of silent divergence)
