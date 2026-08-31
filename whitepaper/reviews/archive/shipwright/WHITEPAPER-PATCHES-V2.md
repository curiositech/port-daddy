# Whitepaper v2 — Patch Specification

**Target file:** `whitepaper/source/agent-transactions-whitepaper.tex`
(the canonical source; generated publication copies are synchronized after rebuild)

**Status:** Patch spec — apply in order. Each patch is scoped. Do not
attempt all in one PR.

**Prior doc:** `BONDED-COMMONS-PATCHES.md` (P1–P5). This supersedes it
with the additional material produced in the 2026-04-20 session:
pheromone lineage, passkey accounts, consolidated verbs, vibe time,
and — importantly — **Thomas Youle as co-author** on the Bonded
Advisor pricing section.

---

## §0 Front-matter changes (applies once)

### P0-a — Version + date bump

```latex
% BEFORE
\fancyfoot[C]{\small Port Daddy v3.8.0}
\date{March 2026\\Version 1.0}

% AFTER
\fancyfoot[C]{\small Port Daddy v3.9 — pre-release}
\date{April 2026\\Version 2.0 (pre-print)}
```

### P0-b — Add Thomas Youle as co-author on the pricing section

**Not** a primary author on the whitepaper as a whole — he contributed
the competitive-insurance mechanism in §8. The appropriate convention
is primary author + "with pricing mechanism contributed by Thomas
Youle."

```latex
% BEFORE
\author{
  \textbf{Erich Owens}\\[0.2cm]
  The Port Daddy Engineering Team\\[0.2cm]
  \texttt{engineering@portdaddy.dev}
}

% AFTER
\author{
  \textbf{Erich Owens}\\[0.2cm]
  The Port Daddy Engineering Team\\[0.2cm]
  \texttt{engineering@portdaddy.dev}\\[0.4cm]
  with the competitive-insurance pricing mechanism (\S8.4) by\\[0.1cm]
  \textbf{Thomas Youle}\\[0.1cm]
  Business Economics \& Public Policy\\[0.1cm]
  Indiana University
}
```

Add a small acknowledgements footnote where §8.4 opens (see P5).

### P0-c — Abstract addendum

Append two sentences to the existing abstract:

```latex
% APPEND at end of existing \begin{abstract}...\end{abstract}
We further show how the commons authority can be equipped with a
\emph{mutable-signal ledger} (\S4.3) that supports revocation,
renaming, and provenance-aware propagation of coordination hints
without sacrificing attribution integrity. Finally, we describe a
competitive-insurance pricing mechanism (\S8.4, contributed by
Youle) in which insurer agents bid to underwrite agent
transactions, replacing static parameter selection with market-
discovered bond prices.
```

---

## §1 Apply the original P1–P5 patches (from BONDED-COMMONS-PATCHES.md)

Re-confirm these still apply in 3.9 cadence; minor renumbering where
noted.

- **P1 Conservation Theorem** → inserts a proved theorem + proof at
  end of §2.3 (unchanged). Cite `lib/bonds.ts`.
- **P2 Cuckoo-filter revocation protocol** → §2.5 Anchor Protocol
  revocation (unchanged).
- **P3 Merkle Forest + inclusion proofs** → §4.2, replaces current
  §4.2 (unchanged).
- **P4 Federated-sovereign replacement for "single-node scope"** →
  §7 opening, describes passkey-first accounts + Merkle gossip.
  *Update from BONDED-COMMONS-PATCHES.md:* cite
  `USER-ACCOUNTS-KMS.md` as the accompanying design doc; do NOT
  specify a cloud vendor in theory text (use abstract KMS
  properties P1–P5 from that doc).
- **P5 Pricing (includes Bonded Advisor)** → §8.1–8.3 (lower
  bound + scope multiplier + reputation discount + Shipwright as
  advisor). *In v2 of the whitepaper, split P5:*
  - §8.1–8.3 remain as Erich / PD Team content.
  - §8.4 (new) is the Youle-contributed competitive-insurance
    mechanism — see §5 below.

---

## §2 NEW: §4.3 Mutable-Signal Ledger (pheromone lineage)

Insert after the existing §4.2 (Merkle Forest) and before §4.4
(advisory vs. enforced). Source: `PHEROMONE-LIFECYCLE-AND-HEAT-TREES.md`.

### §4.3.1 Motivation

Stigmergic coordination originated in biology, where pheromones are
accumulate-only (ants deposit; the environment evaporates).
Software agents need the dual: coordination signals must be
revocable, renamable, and provenance-attributable as understanding
evolves.

### §4.3.2 Event-sourced pheromones

Each entity's pheromone state is a view over an append-only event
ledger:

\[
\sigma_t(e, k) = \text{decay}(S, t - t_0) \cdot
\mathbb{1}[\text{not revoked or expired in }(t_0, t]]
\]

where $S$ is the last spray strength on key $k$ of entity $e$ at
time $t_0$, and $\text{decay}$ is the geometric decay defined in §4.1.
Revocation is an event; rename is a rewrite-pointer event; fork
creates a new key namespace whose provenance is traceable via the
event chain.

### §4.3.3 Properties

- **Attribution invariant**: every $\sigma_t$ value has a
  deterministic provenance chain back to one signing principal.
- **Rollback safety**: a consumer that reads $\sigma$ at time $t$
  and later discovers a revocation at time $t' < t$ can compute
  the correct counterfactual view.
- **Conservation**: revocation does not erase; it appends. The
  event ledger is monotone.

### §4.3.4 Integration with Merkle Forest

Pheromone events are included in the session tree (§4.2): each
session's root summarizes the events it produced. Harbor roots
summarize session roots. Revocations are thus transparent to
witnesses.

---

## §3 NEW: §7.4 Passkey-first Accounts + Device Pairing

Replace the placeholder §7 (federated sovereignty) content about
account identity with the passkey-first design from
`USER-ACCOUNTS-KMS.md`. Key claims for the whitepaper:

- **Passkeys, not passwords.** Identity is anchored in WebAuthn-
  backed device keypairs. No phishable secrets, no passphrase on
  the critical path.
- **Device pairing via existing-trusted-device rewrap.** New
  devices enroll by exchanging a short-lived pairing token that
  re-encrypts the KMS master under the new device's public key.
- **Phone as viewer, not peer.** Mobile devices sign low-stakes
  actions (approve an ask, bump budget) over a WebSocket viewer
  channel; they do not run the full daemon.
- **Account-bounded Merkle forest.** Each account's harbors gossip
  roots among its devices; optional cross-account gossip requires
  explicit signed consent.

State in the paper what we do NOT do: we do not require passwords,
we do not use TOTP as a primary factor, we do not couple recovery
to a single cloud vendor.

---

## §4 NEW: §9 Coordination as Substrate (Expressive-act taxonomy)

New section after §8 (pricing) and before the conclusion. Source:
`CONSOLIDATED-VERBS-AND-UI.md §1`.

### §9.1 Five expressive classes

Introduce the taxonomy and argue it covers the expressive acts
agents require:

1. **Signal** — "something happened" (notes, tuples, pheromones,
   activity events).
2. **Request** — "decision / input / approval needed"
   (escalations).
3. **Distress** — "I am stuck, repeatedly" (bounded enum: auth,
   conflict, permission, budget, invariant).
4. **Commons** — "shared durable state" (tuples kinds, graph
   edges, channels, proposals).
5. **Proposal** — "here is a plan; commit?"

### §9.2 Why this matters for the bonded commons

Each expressive class has a different bonding profile:
- Signal class: cheap, numerous, micro-bonds or reputation-
  discounted. Slashable for false alarm.
- Request class: bonded by cost of the human's time + the
  downstream action cost.
- Distress class: bonded by the blast radius if an agent uses it
  to halt sibling agents abusively.
- Commons: bonded by the storage cost + slashable for pollution.
- Proposal: bonded by the cost of reviewing + implementing.

Treating all coordination as one uniform "bonded action" misses
the price-discovery differences. The Bonded Advisor (§8) must
price each class separately.

---

## §5 NEW: §8.4 Competitive-insurance pricing mechanism
### with Thomas Youle (Indiana University, Business Economics & Public Policy)

**Opening footnote at section head:**

```latex
\section{Competitive-Insurance Pricing Mechanism}
\footnote{This section contributed by Thomas Youle (Indiana
University, Business Economics and Public Policy) based on
conversations with the primary author in March–April 2026. The
mechanism builds on classical competitive-insurance market
literature (Rothschild and Stiglitz 1976; Wilson 1977) adapted to
the agent-transactions setting.}
```

**Content to write** (draft here; economist pass to follow):

### §8.4.1 The mechanism

Instead of a static bond size $B(\pi, r, s)$ selected by the
commons authority (§8.2), allow a market of \emph{insurer agents}
to bid on underwriting each agent transaction. An insurer agent
$I$ offers a quote $(q_I, c_I)$ where $q_I$ is the required
premium and $c_I$ is the claim ceiling.

Principal $P$ submits a transaction $T$ requiring bond coverage
$B_T$. Insurers quote; principal selects. If the transaction
proceeds and damages are assessed at $d$ with $d \le c_I$, the
insurer pays. Otherwise principal pays up to $B_T - c_I$ from its
own stake.

### §8.4.2 Market-discovered pricing

The premium $q_I$ equals the insurer's expected loss $\mathbb{E}[d
\mid T, \text{agent history}]$ plus a risk-premium $\alpha_I$ that
encodes the insurer's risk aversion and its cost of capital. In
equilibrium under competition, $q_I \to \mathbb{E}[d]$ for
risk-neutral insurers (Rothschild–Stiglitz). Market discovery
replaces the authority's best-guess parameter selection.

### §8.4.3 Adverse-selection controls

To avoid the classic lemons problem, the mechanism requires:
- **Public agent reputation history** (from §4.2 Merkle forest).
- **Principal-bound slashing** if an agent's history is
  misrepresented at time of quote.
- **Insurer capital reserve** backed by on-chain stake (same
  bond mechanism, recursive — an insurer posts bond that its
  claim ceilings are funded).

### §8.4.4 Welfare properties

Claim (to be proven by Youle in appendix):
Under full information and competitive entry, the market-
discovered premium Pareto-dominates any authority-chosen static
parameter.

### §8.4.5 Relationship to Shipwright (§8.3)

The "Bonded Advisor" of §8.3 becomes, in this framing, the
matchmaker + reputation oracle in the insurance market. It does
not set prices; it provides information.

---

## §6 NEW: §10 Vibe Time and Observability

Short section (1-2 pages) from `VIBE-TIME.md`. Key points:

- Causal-density temporal axis: $t_{\text{vibe}} = \int
  \text{vibe\_rate}(\tau)\,d\tau$.
- Token-rate telemetry as first-class signal.
- Replay JSONL as artifact — and as training data for DPO/SFT.
- The privacy contract: opt-in, redaction, encryption, LRU
  eviction.

The paper should position this as *observability for multi-agent
coding as a category*, not a PD-specific feature.

---

## §7 UPDATE: §11 (was §9) Conclusion

Update the conclusion to thread together:
1. Why the bonded commons is load-bearing (unchanged).
2. Why the Merkle forest makes attribution cheap enough to scale
   (updated from P3).
3. Why mutable-signal ledgers preserve attribution through
   evolution (new from §4.3).
4. Why competitive-insurance pricing scales better than static
   parameters (new from §8.4 / Youle).
5. Why the expressive taxonomy (§9) is required for any
   bonded-action pricing to be coherent.
6. Why vibe-time and replay give the substrate the empirical
   grounding to iterate (new from §10).

---

## §8 New proofs to land

Each of these should either appear in the paper (short) or in an
appendix (full):

- **ProVerif model of passkey device pairing** (from
  `USER-ACCOUNTS-KMS.md`). Two properties: (a) no unauthorized
  device can derive the KMS master key, (b) revoked devices
  cannot participate in future rewraps.
- **Kani + TLA+ on bond state machine conservation**
  (from `FLEETCONTROL-HARDENING.md`). Two properties:
  (a) supply + escrow + commons is invariant, (b) no agent spawns
  without a posted bond.
- **Measurement appendix:** cost + token corpus from one month of
  real PD use. Anonymous. Forms the empirical baseline for §10.

---

## §9 Bibliography additions

Add to the whitepaper bibliography:

- Rothschild, M., Stiglitz, J. (1976). *Equilibrium in competitive
  insurance markets: An essay on the economics of imperfect
  information.* QJE 90(4):629-649.
- Wilson, C. (1977). *A model of insurance markets with incomplete
  information.* JET 16(2):167-207.
- Eisen, M.B., Spellman, P.T., Brown, P.O., Botstein, D. (1998).
  *Cluster analysis and display of genome-wide expression
  patterns.* PNAS 95(25):14863-14868.
- Theraulaz, G., Bonabeau, E. (1999). *A brief history of
  stigmergy.* Artificial Life 5(2):97-116.
- Fan, B., Andersen, D.G., Kaminsky, M., Mitzenmacher, M.D.
  (2014). *Cuckoo filter: Practically better than Bloom.* (already
  cited via P2 — keep.)

---

## §10 How to apply these patches

1. **Clone the LaTeX file** to a working branch.
2. **Apply P0 (front matter) + P1–P5 (BONDED-COMMONS-PATCHES)** first;
   rebuild; verify renders.
3. **Apply §2 (§4.3 mutable-signal ledger), §3 (§7.4 passkeys),
   §4 (§9 taxonomy), §6 (§10 vibe time).** Rebuild.
4. **Apply §5 (§8.4 Youle).** Send Youle the section for review/edit
   before it lands. His pass is the authoritative version of §8.4.2
   and §8.4.4.
5. **Apply §7 (conclusion update)** last.
6. **Add bibliography entries (§9).**
7. **Rebuild PDF; verify; copy to all three LaTeX copies.**
8. **Delete** `BONDED-COMMONS-PATCHES.md` after step 2 is merged
   (it is superseded by this doc, which references it by name).

---

## §11 Non-goals for v2

Things we are **not** doing in v2:

- We are not claiming empirical dominance of the insurance mechanism
  without the proof. The Youle contribution is a mechanism; its
  Pareto-dominance is a claim requiring proof.
- We are not making the whitepaper into a product brochure. The
  `UTOPIAN-VISION.md` is separate and stays separate.
- We are not adding implementation detail beyond what the proofs
  require. Engineering-level detail belongs in the companion docs.

---

## §12 Timeline

- **Week 1:** P0 + P1–P5 applied. Youle email for §8.4 draft.
- **Week 2:** §4.3, §7.4, §9 drafts. Internal review.
- **Week 3:** Youle feedback on §8.4. Integrate.
- **Week 4:** §10 (vibe time), §7 (conclusion), bibliography.
  ProVerif and Kani/TLA+ proofs added.
- **Week 5:** Copy-edit pass. Rebuild PDF. Publish.

---

*Last updated 2026-04-20. Co-author email for §8.4 coordination TBD
(Eric's correspondence with Youle).*
