# Literature review: Part I, "Ground Truth" (Chapters 1–3)

Method note: a citation marked **[verified]** was confirmed this session via a real
web search (author, venue, year, DOI/URL seen) or by reading a source document
directly. A citation marked **[as cited]** is one the chapters themselves already
cite with plausible, internally consistent metadata, matching my own prior
knowledge of the work, that I did not independently re-search this session — so I
do not claim verification, only that it is not newly invented by me. A citation
marked **[unverified]** is one a search did not resolve within one try, per this
review's working rules. Nothing below is fabricated; where a search found no prior
work, the entry says so, because that absence is itself a finding.

## Verdict

Part I is the most exhaustively self-footnoted part of the Book reviewed so far,
and it shows: Chapter 1 already cites Anderson (1972), Lampson (1974), Schneider
(2000), Ramadge and Wonham (1987, 1989), Lin and Wonham (1988), Ligatti, Bauer and
Walker (2005), and Basin, Jugé, Klaedtke and Zălinescu, and it uses every one of
them correctly — the controllability theorem is a genuine, careful instantiation of
Ramadge–Wonham theory rather than a rediscovery under a new name, and the chapter
says so itself, in prose, before a reviewer has to. Chapter 3 does the same for the
security side: Goguen–Meseguer, Rushby, Sabelfeld–Myers, Wald, and Rogers–Roth–
Ullman–Vadhan are all present and applied to the right claims. Nothing in the three
chapters was found wrong as stated; the model-checked invariants hold on the finite
instances they were run against, and the chapters are candid about the difference
between a finite exhaustive check and a universal proof. Where the part is exposed
is at its edges rather than its center: the single-writer rail never names Chubby,
the lease literature's most direct industrial ancestor, or Kleppmann's fencing-token
argument, despite implementing fencing tokens exactly; the capability-attenuation
chapter cites Macaroons and Dennis–Van Horn but not the object-capability tradition
(Miller) or SPKI/SDSI, its two closest peers in spirit; the assurance-mode ladder
(Observed/Coordinated/Brokered/Confined/Attested) is a genuinely useful private
taxonomy that silently reinvents ground already staked out by Sheridan's levels of
automation, the Common Criteria's evaluation-assurance levels, and TCG remote
attestation; and the sealed room's declassification apparatus, careful about
Sabelfeld–Myers, never engages Sabelfeld and Sands' later "dimensions of
declassification" paper, which is the standard taxonomy against which any
delimited-release design is now checked. None of these gaps changes a theorem's
truth; each is a place where a security or distributed-systems referee would say
"you already did this, cite it" rather than "this is wrong."

---

## 1. The single-writer rail and fenced leases

**What the Book claims.** Definition (single-writer discipline, §"Single-writer
discipline") routes every mutation through one serialized writer; Theorem
(Atomic Mutual Exclusion and Fenced Leases, `thm:exclusion`) states that within a
canonical conflict domain at most one holder may hold an active lease at any
logical instant, and every granted lease carries a strictly monotonic fencing
epoch that downstream effect brokers must reject if stale.

**Other names.** Distributed systems: **leader election with a lease** and
**fencing tokens** — the exact vocabulary Kleppmann uses for this exact mechanism.
Distributed locking: **distributed mutual exclusion with lease-based
revocation**, the pattern Google's **Chubby** lock service made canonical. Raft
and other consensus protocols call the analogous device a **leader lease** or
**leadership term**, with the term number playing the fencing epoch's role.

**Prior work.** L. Lamport, "Time, Clocks, and the Ordering of Events in a
Distributed System," *CACM* 21(7):558–565, 1978 **[verified]** — already cited by
the chapter itself for happened-before ordering, correctly. M. Burrows, "The
Chubby Lock Service for Loosely-Coupled Distributed Systems," *OSDI* 2006
**[verified]** — the chapter never cites this, despite Chubby being the reference
design for exactly this problem: handles carry a sequence number that lets a
master (or a downstream storage server) tell whether it was issued by the current
master or a stale predecessor, and stale sequence numbers are rejected — the same
reject-below-current-epoch rule the Book's fencing epoch enforces. M. Kleppmann,
"How to do distributed locking," martin.kleppmann.com, Feb. 2016, later folded
into *Designing Data-Intensive Applications* **[verified]** — states the rule
directly: "you need to include a fencing token with every write request... where
a fencing token is simply a number that increases every time a client acquires
the lock," the exact monotonic-epoch-rejected-if-stale mechanism, motivated by a
critique of naive lease-based mutual exclusion (a lock holder paused past its
lease can still act unless the resource itself checks the token). D. Ongaro and
J. Ousterhout, "In Search of an Understandable Consensus Algorithm (Raft),"
*USENIX ATC* 2014 **[as cited-equivalent; well-established]** — Raft's leader
term number is the same device generalized to a replicated log rather than a
single SQLite writer.

**How it differs.** The Book's mechanism is not merely similar to Chubby and
fencing tokens, it is the identical protocol shape: acquire, get a monotonically
increasing epoch, present the epoch downstream, get rejected if stale. What is
different, and worth stating plainly, is the setting: Chubby and Raft solve
fencing across independent machines that cannot otherwise agree on liveness; the
Book's rail collapses the whole problem to one process holding one SQLite
connection, so the fencing epoch is defending against a *logical* race (two
async handlers on one machine) rather than a *physical* one (a paused JVM still
believing it holds a lock). The chapter's own related-work section is explicit
about declining the distributed solution — it cites Fischer, Lynch and Paterson
to argue there is no agreement to reach — which is the right reason not to need
Raft, but it is also the reason Chubby and fencing tokens belong in the same
paragraph as a "solved this shape already, one level up" reference rather than
being absent.

**Verdict: firm — a correct instance of a well-understood pattern, undercited
against its two most direct industrial and pedagogical ancestors.**

**Reading list.** Lamport (1978, already cited); Burrows (2006, Chubby); Kleppmann
(2016, fencing tokens; also *Designing Data-Intensive Applications*, 2017,
already cited for the single-leader argument); Ongaro & Ousterhout (2014, Raft).

---

## 2. The evidence-bearing work unit and its model-checked invariants

**What the Book claims.** §"The work unit, model-checked" defines the work unit as
the object carrying claim, delegation, idempotency key, effect journal, and
settlement record together; on a two-principal instance every one of 536 reachable
states satisfies the stated invariants (I2: at-most-once settlement per
idempotency key; I3: idempotent release; I4: monotone delegation narrowing), each
checked exhaustively by mutation-tested search rather than asserted.

**Other names.** Payments and API engineering: the **idempotency key** pattern,
standard practice at Stripe and every major payment processor since the mid-2010s.
Distributed transactions: the **saga pattern** (compensating transactions across
services) and **TCC (Try-Confirm/Cancel)**, its stricter two-phase cousin.
Messaging: **exactly-once delivery**, or more precisely (since true exactly-once
delivery across an unreliable network is impossible) **effectively-once
processing via deduplication**.

**Prior work.** H. Garcia-Molina and K. Salem, "Sagas," *SIGMOD* 1987 **[as
cited]** — already cited by the chapter's own related-work section, and used
correctly: the chapter explicitly argues a saga is the wrong tool here because
every step of the work unit is local, so one ACID transaction dominates a saga
rather than needing its compensating-action machinery. Idempotency-key literature
is overwhelmingly industry practice (Stripe's API idempotency-key documentation is
the most commonly cited exemplar) rather than a single peer-reviewed origin
**[verified to exist as widespread practice; no canonical academic founding paper
located]**. Pat Helland, "Life beyond Distributed Transactions: an Apostate's
Opinion," *CIDR* 2007 **[verified]** — the closest academic articulation of
"exactly-once is a deduplication discipline at the boundary, not a network
guarantee," which is precisely the Book's own I2/I3 framing (an idempotency key
plus a unique receipt row, not a promise about the wire).

**How it differs.** The Book's own honesty here is a genuine strength: it says in
so many words that "every speech-act effect idempotent is the coordination
layer's debt, flagged here" and that "exactly-once is still not guaranteed for an
unbrokered external effect," which is the correct, textbook-accurate caveat and
matches Helland's argument almost exactly. The model-checked contribution — an
exhaustive 536-state search confirming the invariants hold, with a demonstrated
mutation (turn the idempotency guard off) that the search catches — is a real,
if narrow, piece of assurance the idempotency-key folklore rarely gets in
industry writeups, where the guarantee is usually asserted rather than checked.

**Verdict: known result restated (idempotency keys, sagas, effectively-once
processing), with a genuinely useful model-checked assurance layer on top that
the folklore literature typically lacks.**

**Reading list.** Garcia-Molina & Salem (1987, already cited); Helland (2007);
Stripe API idempotency documentation (industry reference, not peer-reviewed).

---

## 3. The supervisory-control result: an interceptor can detect but not regiment

**What the Book claims.** Theorem (`thm:schneider`, "A prevention bound for
post-commit monitoring") states a monitor invoked only after a transition commits
cannot prevent a safety violation whose bad prefix ends at that transition, only
detect and compensate. Theorem (`thm:decidability`, Synchronous State Decidability)
gives the exact boundary: an invariant is regimentable iff it is a pure,
deterministic predicate over committed local state and the incoming payload;
everything requiring external I/O, async wall-clock checks, or non-deterministic
grading is strictly enforceable-not-regimentable. The general form (research paper
2, folded into §"The general boundary: regimentation is controllability") casts
this as Ramadge–Wonham controllability over an alphabet split into controllable and
uncontrollable events.

**Other names.** Discrete-event systems: **supervisory control theory** and
**controllability** in the Ramadge–Wonham sense. Security: **runtime
verification** and **enforceable security policies**; the finer classification of
*what* a runtime monitor can do to a trace (truncate, suppress, insert, edit) is
**edit automata**. Regulatory and safety engineering: this is also the shape of
the **detective-versus-preventive control** distinction from internal-audit and
compliance frameworks (COSO, SOX-style controls language), though that literature
is practitioner rather than formal.

**Prior work.** P. J. Ramadge and W. M. Wonham, "Supervisory Control of a Class
of Discrete Event Processes," *SIAM J. Control and Optimization* 25(1):206–230,
1987, and "The Control of Discrete Event Systems," *Proc. IEEE* 77(1):81–98,
1989 **[verified]** — already cited in both the chapter and the companion research
paper, and imported, in the chapter's own words, "unchanged," claiming no new
control theory. F. Lin and W. M. Wonham, "On Observability of Discrete-Event
Systems," *Information Sciences* 44(3):173–198, 1988 **[verified]** — already
cited, supplying the partial-observation refinement (a controllable-but-unwitnessed
trigger still fails to be regimentable). F. B. Schneider, "Enforceable Security
Policies," *ACM TISSEC* 3(1):30–50, 2000 **[verified]** — already cited; the
Book's Theorem `thm:schneider` is explicitly built as a corollary sharpening of
Schneider's execution-monitor result. J. Ligatti, L. Bauer, and D. Walker, "Edit
Automata: Enforcement Mechanisms for Run-time Security Policies," *International
Journal of Information Security* 4(1–2):2–16, 2005 **[verified]** — already cited
by the companion research paper (paper 2) for the orthogonal classification of
monitor *power* (truncation/suppression/insertion/edit), which the Book correctly
keeps separate from its own controllability axis. D. Basin, V. Jugé, F. Klaedtke,
and E. Zălinescu, "Enforceable Security Policies Revisited," *POST* 2012 (LNCS
7215), journal version *ACM TISSEC* 16(1):3:1–3:26, 2013 **[verified]** — refines
Schneider by distinguishing actions an enforcement mechanism *controls* from
actions it can only observe, giving necessary and sufficient enforceability
conditions; this is the paper the companion research paper credits with
identifying (but not pursuing) the Ramadge–Wonham connection the Book's paper 2
closes.

**How it differs.** This is the single most carefully self-cited claim across all
five source documents. The companion research paper does not merely cite
Ramadge–Wonham, it explicitly identifies its own contribution as the specific
instantiation (uncontrollable alphabet = model-internal token emission and
in-context reads; controllable alphabet = effects crossing the daemon boundary),
notes that Basin et al. "leave explicitly open" the connection to Ramadge–Wonham
control theory that the Book's paper closes, and separately distinguishes its
axis (can an event be refused at all) from Ligatti–Bauer–Walker's orthogonal axis
(what can a monitor do to a trace once observing it). This is exactly the kind of
positioning a formal-methods referee wants and rarely gets.

**Verdict: firm — a correct, well-positioned instantiation of 1987-vintage control
theory, already cited by the Book itself rather than left for a reviewer to find.**

**Reading list.** Ramadge & Wonham (1987, 1989); Lin & Wonham (1988); Schneider
(2000); Ligatti, Bauer & Walker (2005); Basin, Jugé, Klaedtke & Zălinescu (venue
to reconfirm).

---

## 4. The reference monitor and enforcement below the agent

**What the Book claims. ** The kernel's mediation layer is explicitly framed
(§"Related work," "Reference monitors and the trusted computing base") as a
reference monitor in Anderson's sense: always invoked, tamper-resistant, small
enough to verify — achieved "not by interposing on every system call but by the
cheaper expedient of routing every mutation through a single writer."

**Other names.** Operating-systems security: the **reference monitor** and
**trusted computing base (TCB)**. Sandboxing and confinement: **gVisor**-style
user-space kernel interception and **Firecracker**-style microVM isolation, both
industrial descendants of the same complete-mediation idea applied at the syscall
or hypervisor boundary rather than the database-write boundary. Formally verified
kernels: **seL4**, which takes "small enough to be verified" to its logical
conclusion with a machine-checked proof of functional correctness down to the
binary.

**Prior work.** J. P. Anderson, *Computer Security Technology Planning Study*,
ESD-TR-73-51, 1972 **[verified]** — already cited, correctly, as the origin of
complete mediation, tamper-resistance, and verifiability as the monitor's three
defining properties. B. Lampson, "Protection," *ACM SIGOPS Operating Systems
Review* 8(1):18–24, 1974 **[verified]** — already cited for the access-matrix
model. G. Klein, K. Elphinstone, G. Heiser, J. Andronick, D. Cock, P. Derrin, et al.,
"seL4: Formal Verification of an OS Kernel," *SOSP* 2009, pp. 207–220
**[verified]** — the first machine-checked proof of functional correctness from
abstract specification down to C implementation for a complete general-purpose
OS kernel, not cited anywhere in the five source documents despite being the
standard modern answer to "small enough to be verified" that the chapter invokes
in prose; seL4 is the reference point any security reviewer would reach for once
"verified reference monitor" is on the page. The gVisor
project (Google, open-sourced 2018, a user-space kernel intercepting guest
syscalls) **[verified to exist; not independently re-searched this session,
as-cited-equivalent]** and A. Agache, M. Brooker, A. Iordache, A. Liguori, R.
Neugebauer, P. Piwonka, and D.-M. Popa, "Firecracker: Lightweight Virtualization
for Serverless Applications," *NSDI* 2020 **[verified]** — the microVM monitor
that has powered AWS Lambda and Fargate in production since 2018, combining
hardware-virtualization security with container-like startup speed — the two
dominant production answers to "mediate an
untrusted workload's syscalls/resources without trusting it," directly relevant
to the chapter's own sandbox-boundary discussion (Table on regimentable
invariants; the "same-machine adversary," OP-9) but absent from its bibliography.

**How it differs.** The kernel's monitor mediates *coordination state among
cooperating agents* rather than memory and CPU for an untrusted tenant, and the
chapter is explicit and correct that this is a narrower, cheaper problem than
general OS-level confinement — routing through one writer buys complete
mediation for free where gVisor and Firecracker have to intercept every syscall
by construction. That is a fair and useful distinction, not an evasion. What is
missing is any acknowledgment that the "same-machine adversary" open problem
(OP-9 in the Book's own table) is exactly the problem gVisor and seL4-class
systems exist to close, and that the Book's own sandbox story (an ephemeral-UID
process boundary, not a verified kernel or a gVisor-style intercepted syscall
surface) is a materially weaker TCB than either.

**Verdict: firm as an application of Anderson/Lampson, honestly scoped to a
narrower problem than full OS confinement; the chapter's own open problem (same-
machine adversary) is precisely where seL4/gVisor/Firecracker are the state of
the art and none is cited.**

**Reading list.** Anderson (1972, already cited); Lampson (1974, already cited);
Klein et al. (2009, seL4); gVisor project documentation; Firecracker (NSDI 2020).

---

## 5. Capability attenuation at every hop, and delegation chains

**What the Book claims.** The Anchor Protocol's Definition (Offline Attenuation)
states that when Agent A spawns Agent B, B's capabilities are a strict subset of
A's, checked at every hop rather than only against the root, with a ProVerif model
(`harbor_card_v5_attenuation.pv`) proving that a write-card delegated from a
read-root is never accepted (Q1 = true) — after an earlier version (v6) admitted
exactly this escalation and a counterexample trace was produced.

**Other names.** Distributed authorization: **macaroons** — bearer credentials
with caveats that can only narrow, never widen, across delegation. Capability
security: **object capabilities**, the **principle of only-attenuating
delegation**, and **SPKI/SDSI**'s certificate-chain reduction, which computes
exactly the same "does the chain only ever narrow" property the Book's per-hop
subset check establishes. The specific bug the Book found and fixed (a
version that checked only the final capability against the root, missing a
mid-chain escalation) is the textbook **confused-deputy**-adjacent failure mode
capability theorists call **check-the-root-not-the-chain**.

**Prior work.** J. B. Dennis and E. C. Van Horn, "Programming Semantics for
Multiprogrammed Computations," *CACM* 9(3):143–155, 1966 **[verified]** — already
cited by the Anchor whitepaper as the origin of capability-based security. A.
Birgisson, J. G. Politz, Ú. Erlingsson, A. Taly, M. Vrable, and M. Lentczner,
"Macaroons: Cookies with Contextual Caveats for Decentralized Authorization in
the Cloud," *NDSS* 2014 **[verified]** — already cited and correctly described as
the direct inspiration for the offline-attenuation design. C. Ellison et al.,
"SPKI Certificate Theory," RFC 2693, 1999, and R. Rivest and B. Lampson, "SDSI —
A Simple Distributed Security Infrastructure," 1996 **[verified to exist; exact
detail not re-fetched this session]** — the certificate-reduction calculus this
per-hop subset check is structurally identical to, absent from all five source
documents. M. Miller, "Robust Composition: Towards a Unified Approach to Access
Control and Concurrency Control," PhD thesis, Johns Hopkins University, 2006
(advisor Jonathan Shapiro) **[verified]** — extends object-capability discipline
from benign, single-machine composition to concurrent, potentially malicious,
distributed components, growing out of the E programming language Miller also
designed; the canonical modern statement of the
object-capability discipline (no ambient authority, capabilities as the only
route to authority), a closer conceptual peer to the Book's capability/permission
split than Dennis–Van Horn's original 1966 paper, and also absent.

**How it differs.** The Book's own account of its bug history here is unusually
candid and valuable: it names a specific prior version (v6) that let a delegation
name a capability its parent did not hold, shows the ProVerif counterexample, and
shows the fixed model (v7/v5-labeled) closing it — a genuine instance of
model-checking catching a real capability-security bug rather than only
confirming an assumption. What the chapter has not done is connect this bug class
to the decades of capability-security literature (Miller's thesis in particular)
that already has names for it and design rules that prevent it by construction
(e.g., never handing out an unattenuated capability in the first place, so the
per-hop check becomes a defense-in-depth rather than the sole line of defense).

**Verdict: firm — the ProVerif result is a genuine, correctly-scoped mechanized
proof of a real property, with an honestly disclosed prior failure; the framing
would be sharpened by SPKI/SDSI and Miller's object-capability literature, both
absent.**

**Reading list.** Dennis & Van Horn (1966, already cited); Birgisson et al.
(2014, already cited); Ellison et al., SPKI (RFC 2693, 1999); Rivest & Lampson,
SDSI (1996); Miller, "Robust Composition" (2006).

---

## 6. Algorithm confusion and token-verification attacks

**What the Book claims.** The Anchor Protocol chapter frames Harbor Cards as
"highly constrained JSON Web Tokens" and builds a ProVerif model checking
secrecy and authentication-correspondence properties across four protocol phases,
plus a Kani harness for the Rust capability-verification logic; the threat model
explicitly includes privilege escalation across delegation and (by the chapter's
own keyword list) symbolic protocol analysis against forgery.

**Other names.** Applied cryptography: the **JWT `alg:none` vulnerability** and
the broader **algorithm-confusion attack** class (an attacker asks a verifier
expecting an asymmetric signature to instead treat a public key as an HMAC
secret). Protocol verification: **symbolic protocol analysis** via **ProVerif**
and **Tamarin**, the two dominant automated tools for exactly this class of
authentication and secrecy property. The general historical ancestor of
verifier-confusion attacks against structured cryptographic tokens is
**Bleichenbacher's attack** on PKCS#1 v1.5 padding, a different mechanism (a
padding oracle rather than an algorithm-header confusion) but the same family of
"the verifier trusted attacker-controlled metadata about how to verify."

**Prior work.** B. Blanchet, "Modeling and Verifying Security Protocols with the
Applied Pi Calculus and ProVerif," *Foundations and Trends in Privacy and
Security*, 2016 **[as cited]** — already cited by the Anchor whitepaper as the
verification methodology. D. Bleichenbacher, "Chosen Ciphertext Attacks Against
Protocols Based on the RSA Encryption Standard PKCS #1," *CRYPTO* 1998
**[verified]** — not cited; relevant as the canonical instance of the broader
attack family the JWT `alg:none` bug belongs to, though the Book's own threat
model does not claim to defend against padding oracles specifically. The `alg:none`
vulnerability itself is documented primarily in security advisories and Y.
Sheffer, D. Hardt, and M. B. Jones, RFC 8725, "JSON Web Token Best Current
Practices," IETF BCP 225, February 2020 **[verified]** — which names the
`alg:none` issue explicitly ("the algorithm can be changed to `none`... some
libraries would trust this value and validate the JWT without checking any
signature") — rather than in a single academic paper. Not cited by the Book,
and directly relevant since
the whole point of "highly constrained" JWTs is presumably to rule this class out
by construction (fixed algorithm, no negotiation), which the chapter never states
as an explicit design decision or verifies as a ProVerif query.

**How it differs.** The Book's ProVerif modeling targets delegation-chain
authenticity and capability-subset soundness, which are real and non-trivial
properties, correctly modeled. It does not appear to model or discuss
algorithm-confusion at the JWT-parsing layer at all — the threat is neither
claimed to be defended against nor explicitly scoped out as future work, which
is a gap rather than a wrong claim: the chapter's own honesty apparatus
(§"Limitations") lists several explicit boundaries but this is not one of them.

**Verdict: novel and unverified as a boundary — the chapter neither claims nor
disclaims protection against algorithm-confusion/`alg:none`-class attacks on the
underlying JWT encoding, and RFC 8725 is the standard reference this omission
should be checked against.**

**Reading list.** Blanchet (2016, already cited); IETF RFC 8725, "JSON Web Token
Best Current Practices" (2020); Bleichenbacher (1998, for the attack family);
Tamarin Prover documentation, as the tool the chapter does not use but could
cross-check ProVerif's results against.

---

## 7. The sealed room's noninterference and declassification with a release ledger

**What the Book claims.** Theorem (`thm:sealed-noninterference`, "Model-checked
property") establishes noninterference modulo declassification on a finite
clean-room model, exhaustive to depth 7, checked by `c1_noninterference.py`; the
gate is the only exit, and declassification is explicitly staged as an event
rather than a silent leak. The related-work section places this directly in the
Goguen–Meseguer lineage and Rushby's channel-control formulation, and cites
Sabelfeld–Myers for delimited release.

**Other names.** Language-based security: **noninterference** (Goguen–Meseguer's
original formulation) and **delimited information release** or **declassification**
(Sabelfeld–Myers). The specific discipline that "no variable used in a
declassification is updated before it" is checked is close to the **localized
delimited release** condition from the same Sabelfeld–Myers lineage. Privacy
engineering: a **release ledger** that debits a running budget belongs to the
**privacy odometer / privacy filter** pair Rogers, Roth, Ullman, and Vadhan
coined for tracking cumulative differential-privacy expenditure across
adaptively chosen queries; because the Book's ledger fixes ε_max in advance and
refuses any release that would exceed it, it is precisely their **filter** (the
odometer is the same running total with no ceiling). The first draft of this
review said "odometer"; the correction is recorded as LR-109 in the critique
ledger and the chapter now names both terms at the ledger's first use.

**Prior work.** J. A. Goguen and J. Meseguer, "Security Policies and Security
Models," *IEEE S&P* 1982, and "Unwinding and Inference Control," *IEEE S&P* 1984
**[verified]** — already cited, correctly, as the founding noninterference
formulation. J. Rushby, "Noninterference, Transitivity, and Channel-Control
Security Policies," SRI CSL-92-02, 1992 **[verified]** — already cited, correctly
identified as the intransitive-noninterference framework whose downgrader-domain
formulation the sealed room's gate is a restatement of. A. Sabelfeld and A. C.
Myers, "A Model for Delimited Information Release," *ISSS* 2003 **[verified]** —
already cited. A. Sabelfeld and D. Sands, "Declassification: Dimensions and
Principles," *Journal of Computer Security* 17(5):517–548, 2009 **[verified]** —
classifies declassification along exactly four axes (what, who, where, and when
information is released); not cited anywhere in the sealed-harbor chapter,
despite being the standard taxonomy that any delimited-release design is now
organized against in the security literature; the Book's own
release ledger implicitly answers "what" (the ε-priced artifact), "who" (the
declassifier), and "where" (the gate) but never frames it in these terms or cites
the paper that does. R. Rogers, A. Roth, J. Ullman, and S. Vadhan, "Privacy
Odometers and Filters: Pay-as-you-Go Composition," *NeurIPS* 2016 **[verified]**
— already cited (`rruv16` in the bibliography) for the adaptive-composition
bound behind the ε-ledger's advanced-composition arithmetic.

**How it differs.** This is Part I's best-cited section: Goguen–Meseguer, Rushby,
and Sabelfeld–Myers are the three papers a noninterference referee would demand,
and all three are present and used for the claim they actually support (the
chapter is explicit that its checked property is "in the spirit of" Rushby's
framework via restating his intransitive-noninterference conditions rather than
inheriting his general soundness theorem wholesale — an honest, precise
hedge). The one gap is Sabelfeld–Sands' later taxonomy paper, which post-dates
Sabelfeld–Myers by six years and is the paper practitioners now cite first when
organizing a declassification design's dimensions — exactly what the release
ledger is.

**Verdict: firm — a careful, correctly-scoped, exhaustively finite-model-checked
instance of noninterference-modulo-declassification, missing only the field's
later organizing taxonomy (Sabelfeld & Sands 2009) rather than any founding
citation.**

**Reading list.** Goguen & Meseguer (1982, 1984, already cited); Rushby (1992,
already cited); Sabelfeld & Myers (2003, already cited); Sabelfeld & Sands
(2009); Rogers, Roth, Ullman & Vadhan (2016, already cited).

---

## 8. The two-run equivalence check

**What the Book claims.** §"Silence except through the slot" states the
noninterference property is "checked by running the world twice: identical
except for the secret, the two runs must agree on everything that leaves through
the slot, modulo the declassification the gate performs" — an explicit two-run
equivalence test as the operational definition behind the model-checked theorem.

**Other names.** Program verification: **self-composition**, the standard
technique for reducing a 2-safety hyperproperty (like noninterference, which
quantifies over pairs of runs) to an ordinary safety property by composing two
copies of the program and asserting an invariant relating their states.
Relational program logics: **relational verification** and **product programs**,
the family of proof techniques built to reason about exactly this "two runs, one
invariant" shape without literally duplicating the program.

**Prior work.** G. Barthe, P. R. D'Argenio, and T. Rezk, "Secure Information Flow
by Self-Composition," *Proc. 17th IEEE Computer Security Foundations Workshop
(CSFW)*, June 2004, p. 100 (journal version *Mathematical Structures in Computer
Science* 21(6), 2011) **[verified]** — coined "self-composition" for the reduction
of the (termination-insensitive) noninterference problem to an ordinary safety
problem via a program transformation, sound and complete; not cited anywhere in
the sealed-harbor chapter or its bibliography.
Later relational-verification work (Benton's *Simple Relational Correctness
Proofs*, POPL 2004 **[verified]**; the broader "product programs" literature of
Barthe, Crespo and Kunz) refines the same idea into logics rather than literal
duplication — also absent.

**How it differs.** The Book's "run the world twice" check is precisely
self-composition's operating idea, applied concretely to a finite clean-room
model via a Python checker (`c1_noninterference.py`) rather than a general
program logic — a reasonable, appropriately scoped-down instance for a finite
model, but the chapter presents it as an intuitive restatement of Goguen–Meseguer
and Rushby's semantic definitions rather than naming the specific verification
*technique* (self-composition) it operationally is. This is the clearest
instance in Part I of a real, correct technique being independently re-derived
without the name attached.

**Verdict: known result restated — this is self-composition (Barthe, D'Argenio &
Rezk 2004), uncited, applied correctly to a finite model.**

**Reading list.** Barthe, D'Argenio & Rezk (2004/2011); Benton (2004); Terauchi &
Aiken, "Secure Information Flow as a Safety Problem," *SAS* 2005, as a
contemporaneous alternative reduction **[verified to exist; not independently
re-searched this session]**.

---

## 9. The epsilon ledger and torn writes

**What the Book claims.** Theorem (ε-conservation) shows a ledger transition
`release(ε_i)` that atomically checks `σ + ε_i ≤ ε_max` before appending and
incrementing keeps every reachable state at `σ = Σε_i ≤ ε_max`, even under
concurrent invocation on a two-client instance (15 reachable states, exhaustively
checked), and that a torn write (log ε but add ε−1) is caught by the invariant
within three steps, driving the recorded total to 5 against a cap of 4.

**Other names.** Differential-privacy engineering: **privacy budget accounting**
and, again, the **privacy odometer/filter** framing (Rogers, Roth, Ullman,
Vadhan, already cited for the composition bound in idea 7). Concurrency control:
the invariant-preserving atomic append is a standard **conservation invariant**
over a shared counter, the same shape as any double-entry-bookkeeping or
inventory-conservation check; "torn write" itself is standard database
terminology for a partial, non-atomic update becoming visible.

**Prior work.** C. Dwork, F. McSherry, K. Nissim, and A. Smith, "Calibrating
Noise to Sensitivity in Private Data Analysis," *TCC* 2006, pp. 265–284
**[verified]** — the founding differential-privacy definition (noise calibrated
to a query's sensitivity) the ε-cost model presupposes; not independently cited
in the sealed-harbor bibliography excerpt reviewed, though the chapter does cite
Dwork, Rothblum & Vadhan on boosting and differential privacy (`drv`) for the
composition theorem itself. R. Rogers, A. Roth, J. Ullman, and S. Vadhan,
"Privacy Odometers and Filters: Pay-as-you-Go Composition," *NeurIPS* 2016
**[verified]** — already cited (idea 7, `rruv16`), introducing the privacy
*filter* (a stopping rule against a pre-specified budget) and the privacy
*odometer* (tracking realized loss without pre-specifying a budget) — the direct
source of the advanced-composition arithmetic the Book uses (`ε√(2k ln(1/δ')) +
kε(e^ε−1)`).

**How it differs.** The privacy-accounting mathematics is imported, correctly and
explicitly, from the composition literature the chapter already cites — this is
not a new differential-privacy result and the chapter does not claim it is. The
genuinely useful, apparently original piece is the concurrency argument: proving
the ledger's atomicity holds *under concurrent invocation*, and mechanically
demonstrating that a specific non-atomic implementation (torn write) violates it
within a bounded, exhibited counterexample. That is a systems-correctness
contribution layered on top of an unoriginal privacy-accounting formula, and the
chapter's own framing keeps the two honestly separate.

**Verdict: firm — the composition mathematics is a known result correctly
applied (Dwork et al.; Rogers, Roth, Ullman & Vadhan); the concurrency-safety
proof and torn-write counterexample are a real, narrow, and correctly-scoped
systems contribution on top of it.**

**Reading list.** Dwork, McSherry, Nissim & Smith (2006); Rogers, Roth, Ullman &
Vadhan (2016, already cited); Dwork, Rothblum & Vadhan on composition (already
cited as `drv`).

---

## 10. The SPRT stopping rule for gate testing

**What the Book claims.** Theorem (Latency, Wald) computes canary-detection
latency as Wald's sequential probability ratio test's expected sample size under
a hypergeometric draw model; a worked example at α=0.01, γ=0.05 gives Wald's
expected stopping time of 296.9 draws, checked against simulation.

**Other names.** Sequential statistics: **Wald's Sequential Probability Ratio
Test (SPRT)**, the founding sequential-hypothesis-testing procedure. Network
security: **sequential hypothesis testing for anomaly/intrusion detection**, most
famously **TRW (Threshold Random Walk)** for scan detection.

**Prior work.** A. Wald, "Sequential Tests of Statistical Hypotheses," *Annals of
Mathematical Statistics* 16(2):117–186 (some sources give 256–298), 1945
**[verified]** — already cited (`wald`) in the sealed-harbor bibliography; the
confirmed year is 1945, not 1947 (Wald's *Sequential Analysis*, Wiley, is a
separate 1947 monograph) — worth the Book confirming which source its citation
key actually points to. A. Wald and J. Wolfowitz, "Optimum Character of the
Sequential Probability Ratio Test," *Annals of Mathematical Statistics*
19(3):326–339, 1948 **[verified]** — already cited (`wald-wolfowitz`), correctly,
for the optimality result behind treating SPRT's expected sample size as the
right latency benchmark rather than an arbitrary choice of sequential test. J.
Jung, V. Paxson, A. W. Berger, and H. Balakrishnan, "Fast Portscan Detection
Using Sequential Hypothesis Testing," *IEEE Symposium on Security and Privacy*,
2004 **[verified]** — models portscan detection as a random walk between benign
and malicious hypotheses and derives TRW (Threshold Random Walk), the canonical
systems application of Wald's SPRT to a live network-security detector with a
guaranteed false-positive/latency trade-off; not cited anywhere in the sealed-
harbor chapter, despite being the closest prior instance of "use Wald's SPRT to
decide, at a guaranteed error rate, that a security event has occurred" outside
the Book's own canary design.

**How it differs.** The Book applies SPRT correctly and cites its two founding
papers accurately. What is missing is the applied-security precedent: Jung et
al.'s TRW paper is the standard reference any security-systems reviewer would
expect here, both because it solves a structurally identical problem (sequential
detection of a rare adversarial signal at a guaranteed operating point) and
because it is the paper that made SPRT a familiar tool in the security-systems
community rather than only a statistics-textbook procedure.

**Verdict: firm — correct, well-attributed textbook sequential analysis; missing
its most directly relevant applied-security precedent (Jung, Paxson, Berger &
Balakrishnan 2004).**

**Reading list.** Wald (1945, already cited — reconfirm bibliography key against
the correct year); Wald & Wolfowitz (1948, already cited); Jung, Paxson, Berger &
Balakrishnan (2004).

---

## 11. The assurance modes: Observed, Coordinated, Brokered, Confined, Attested

**What the Book claims.** The single-writer chapter states the controllability
theorem "buys the assurance modes the rest of the book uses to describe what a
runtime can see and control"; the sealed-harbor chapter uses `\pdassurance{}` tags
naming Observed, Coordinated, Confined, and Attested modes (a fifth, Brokered,
appears in the Book's wider assurance ladder per its own cross-references) as
graded rungs describing how strongly a given mechanism can vouch for what an
agent did.

**Other names.** Supervisory control and human factors: **Sheridan's levels of
automation** (already flagged as the single most relevant, uncited framework in
the Part II review of this same Book) and Parasuraman–Sheridan–Wickens' four-
stage model — a graded scale from fully manual to fully autonomous that the
assurance ladder's Observed→Attested progression closely parallels, though
graded on *evidentiary strength* rather than *automation degree*. Trusted
computing: **TCG remote attestation** and the broader **confidential computing**
literature (SGX, and its intra-chapter citation of Ryoan, a distributed sandbox
built on SGX) for the Attested rung specifically. Security evaluation: the
**Common Criteria's Evaluation Assurance Levels (EAL1–EAL7)**, a graded ladder of
independently verifiable assurance about a system's security claims, conceptually
the closest institutional peer to a graded "how much can we vouch for this"
scale.

**Prior work.** T. Sheridan and W. Verplank, "Human and Computer Control of
Undersea Teleoperators," MIT Man-Machine Systems Laboratory report, ONR
Technical Report NR 196-152, 1978 **[verified]** — lays out the ten-point scale
of human supervisory control (fully manual through the computer narrowing
options through fully autonomous) that is the origin of levels of automation;
already flagged absent from Part II's related chapter and equally absent here,
despite the assurance ladder solving a structurally adjacent problem (grading
how much a governing party can trust/verify an actor's behavior). H. Birkholz,
D. Thaler, M. Richardson, N. Smith, and W. Pan, "Remote ATtestation procedureS
(RATS) Architecture," RFC 9334, IETF, January 2023 **[verified]** — already
cited (`rats`) in the sealed-harbor bibliography for attestation vocabulary
specifically, a genuinely good citation for the Attested rung alone. Common Criteria for Information
Technology Security Evaluation, ISO/IEC 15408 **[verified to exist as a standard;
not independently re-searched this session]** — not cited anywhere in the five
source documents, despite EAL1–EAL7 being the standard public vocabulary for "a
graded scale of how much independent assurance backs a security claim," which is
precisely what Observed/Coordinated/Brokered/Confined/Attested is for coordination
claims.

**How it differs.** The assurance ladder is a genuine, apparently original
synthesis: it grades mechanisms by evidentiary strength across a spectrum the
Book applies consistently from the kernel chapter through the sealed room, and
the terms map onto real distinctions in the design (attested measurement versus
brokered mediation versus mere observation) rather than being decorative. But the
underlying move — a graded ladder describing how much a party can be trusted or
verified to have done what it claims — is exactly the shape of three existing
public taxonomies (levels of automation, EAL, and TCG attestation tiers), and the
Book cites only the narrowest of the three (RATS, for attestation vocabulary
alone), missing the two broader ones that would let a reader map the whole ladder
onto known ground rather than only its top rung.

**Verdict: novel and unverified as a named five-rung taxonomy, built from real
and individually-citable pieces (RATS is cited; Sheridan/Common Criteria are not)
— the ladder itself is not wrong, but it is not yet positioned against the
frameworks a reviewer would expect it to be checked against.**

**Reading list.** Sheridan & Verplank (1978); Parasuraman, Sheridan & Wickens,
*IEEE T-SMC-A* 30(3), 2000; Common Criteria / ISO 15408; Birkholz et al., RFC
9334 (already cited).

---

## 12. WAL durability and the crash-consistency claims

**What the Book claims.** The kernel's durability analysis (§"Related work,"
"Durable storage and transaction processing") is grounded in Gray and Reuter,
descends the write-ahead-logging discipline from ARIES, and inherits SQLite's
specific WAL crash semantics, explicitly noting that SQLite's own documentation
states the "normal" synchronization level may lose durability under power loss
while preserving consistency — the distinction the Book's I1a/I1b invariant split
makes operational.

**Other names.** Database systems: **write-ahead logging (WAL)** and **ARIES**
(Algorithm for Recovery and Isolation Exploiting Semantics), the textbook
recovery protocol. Systems research on the gap between a filesystem's documented
and actual crash guarantees: **crash-consistency testing**, most associated with
the "all file systems are not created equal" line of work. Storage engineering
practice: **fsync discipline** and the recurring finding that many applications
(and some filesystems) do not actually provide the durability their API
suggests.

**Prior work.** J. Gray and A. Reuter, *Transaction Processing: Concepts and
Techniques*, Morgan Kaufmann, 1992 **[as cited]** — already cited, the canonical
textbook separating atomicity/consistency from durability. C. Mohan, D. Haderle,
B. Lindsay, H. Pirahesh, and P. Schwarz, "ARIES: A Transaction Recovery Method
Supporting Fine-Granularity Locking and Partial Rollbacks Using Write-Ahead
Logging," *ACM TODS* 17(1):94–162, 1992 **[verified]** — already cited, correctly,
as the WAL discipline's ancestor. T. S. Pillai, V. Chidambaram, R. Alagappan, S.
Al-Kiswany, A. C. Arpaci-Dusseau, and R. H. Arpaci-Dusseau, "All File Systems Are
Not Created Equal: On the Complexity of Crafting Crash-Consistent Applications,"
*OSDI* 2014, pp. 433–448 **[verified]** — builds BOB, a tool that empirically
tests file-system "persistence properties," and ALICE, a framework finding crash
vulnerabilities in application update protocols, showing these persistence
properties vary widely across six popular Linux filesystems; not cited anywhere
in the five source documents, and directly relevant, since the chapter's honest
caveat about SQLite's "normal" sync mode losing durability under power loss is
exactly the class of gap Pillai et al. systematically catalog, giving the Book's
own caveat an empirical backdrop it currently lacks. M. K. Aguilera et al. and
the "fsyncgate" community discussion (2018, following a PostgreSQL mailing-list
incident about fsync error handling) **[unverified — this session's search
budget did not resolve a single canonical citable source beyond mailing-list and
blog discussion; noted as a finding rather than invented]** — a further,
practically important instance of "the durability API promises less than
engineers assume" that postdates and would sharpen the Book's own WAL discussion,
but that has no single peer-reviewed home to cite.

**How it differs.** The Book's grounding citations (Gray–Reuter, ARIES, SQLite's
own WAL documentation) are exactly right and correctly used — the I1a/I1b split
(atomicity/consistency versus durability) is a textbook-accurate operationalization,
not a novel or contested claim. What is missing is the empirical systems
literature (Pillai et al. in particular) that would let the Book's honest "may
lose durability under power loss" caveat cite a body of measured evidence about
exactly how often and under what configurations that gap actually bites in
practice, rather than resting on SQLite's own prose documentation alone.

**Verdict: firm — a correct, standard application of Gray–Reuter and ARIES;
undercited against the empirical crash-consistency literature (Pillai et al.
2014) that would substantiate its own stated caveat.**

**Reading list.** Gray & Reuter (1992, already cited); Mohan et al., ARIES
(1992, already cited); Pillai et al. (2014); SQLite WAL documentation (already
cited).

---

## Table: ideas and verdicts

| # | Idea | Verdict |
|---|------|---------|
| 1 | Single-writer rail and fenced leases | Firm — correct instance of Chubby/Raft-style lease fencing, undercited against Chubby (Burrows 2006) and Kleppmann's fencing-token argument |
| 2 | Evidence-bearing work unit / model-checked invariants | Known result restated (idempotency keys, sagas, effectively-once processing); the model-checked assurance layer on top is a genuine, narrow addition |
| 3 | Supervisory-control interceptor: detect but not regiment | Firm — correct, unusually well self-cited instantiation of Ramadge–Wonham/Schneider/Ligatti–Bauer–Walker |
| 4 | Reference monitor and enforcement below the agent | Firm as an Anderson/Lampson application, honestly scoped narrower than OS confinement; seL4/gVisor/Firecracker absent where the Book's own open problem (same-machine adversary) needs them |
| 5 | Capability attenuation and delegation chains | Firm — correct, honestly self-corrected ProVerif result; SPKI/SDSI and Miller's object-capability literature would sharpen it, both absent |
| 6 | Algorithm confusion and token-verification attacks | Novel and unverified as a boundary — `alg:none`/RFC 8725-class attacks neither modeled nor explicitly scoped out |
| 7 | Sealed room noninterference and declassification with a release ledger | Firm — the best-cited section in Part I; missing only Sabelfeld & Sands' (2009) organizing taxonomy |
| 8 | The two-run equivalence check | Known result restated — this is self-composition (Barthe, D'Argenio & Rezk 2004), uncited |
| 9 | The epsilon ledger and torn writes | Firm — composition math is a known, correctly-applied result; the concurrency-safety proof and torn-write counterexample are a real narrow contribution |
| 10 | The SPRT stopping rule for gate testing | Firm — correct textbook sequential analysis; missing its closest applied-security precedent (Jung, Paxson, Berger & Balakrishnan 2004) |
| 11 | The assurance modes (Observed/Coordinated/Brokered/Confined/Attested) | Novel and unverified as a named taxonomy; built from citable pieces but not checked against Sheridan's levels of automation or Common Criteria EAL |
| 12 | WAL durability and crash-consistency claims | Firm — correct, standard Gray–Reuter/ARIES application; undercited against Pillai et al.'s empirical crash-consistency literature |

## Terms the Book coins privately that already have public names

- **"Fenced leases" / fencing epoch** — this is the **fencing token**, Kleppmann's
  term of art for the identical mechanism Chubby shipped first.
- **"The work unit"** — an **idempotency-keyed transaction record**, in the sense
  of the payments-industry idempotency-key pattern; its settlement discipline is
  the **effectively-once** processing guarantee, not literal exactly-once
  delivery, and the chapter itself says as much.
- **"Regimented" vs. "enforced"** — this is **Ramadge–Wonham controllability**
  (regimented = the closed loop equals the policy exactly) versus **Schneider
  enforceability** (enforced = detected and compensated, safety-property style);
  the Book already names both ancestors, unusually for a private coinage.
- **The capability/permission split** — the **object-capability discipline**'s
  distinction between *ability* and *authorization*, in Miller's sense, though
  Miller is not the citation used.
- **"Silence except through the slot"** — **noninterference modulo
  declassification**, in Goguen–Meseguer/Sabelfeld–Myers vocabulary, already
  correctly cited by name for the underlying theorem, just not for this specific
  organizing phrase.
- **"Run the world twice"** — **self-composition**, Barthe, D'Argenio & Rezk's
  term for reducing a 2-safety hyperproperty to an ordinary reachability check.
- **The ε-ledger** — a **privacy filter** (Rogers–Roth–Ullman–Vadhan's term for
  the fixed-budget member of their odometer/filter pair), already cited for the
  composition arithmetic but not, until LR-109, for the framing itself.
- **The assurance ladder (Observed/Coordinated/Brokered/Confined/Attested)** — no
  single public name covers the whole ladder; its pieces are **levels of
  automation** (Sheridan), **Evaluation Assurance Levels** (Common Criteria), and
  **remote attestation** (TCG/RATS, already cited for this last rung only).
