# How strong papers in this space are actually built

**Read when** structuring a paper, writing the first sentence, formatting a
contributions list, or deciding where the running example goes.

Everything here is from primary sources fetched and read. Award status is marked
unconfirmed wherever it could not be checked against the venue's own page.

## The opening move: a taxonomy

Nine verbatim openings, each doing a different job. Pick deliberately.

**1. The historical canon.** Opens with a sweeping claim about the field's
central object, then narrates its history before arriving at the question. A
*license to matter* — it says "you already care about this."

> "The Nash equilibrium has been the quintessence of Game Theory."
> — Hakim, Milionis, Papadimitriou & Piliouras, *Swim till You Sink*, SAGT 2024
> (Best Paper, `verified`)

**2. The parable.** No citations, no throat-clearing — a person and a decision.
Formalism deferred entirely to §2.

> "Consider the problem faced by someone who has an object to sell, and who does
> not know how much his prospective buyers might be willing to pay for the
> object."
> — Myerson, *Optimal Auction Design*, Math. Oper. Res. 1981

**3. Recognizable products.** Grounds an abstract guarantee in artifacts the
reader already uses. Security papers do this far more than theory papers.

> "Whether WhatsApp, Signal, Facebook Messenger, or Wire, virtually all modern
> messaging applications prominently advertise end-to-end encryption…"
> — Wallez et al., *TreeSync*, USENIX Security 2023

**4. The doubled scale claim.** Abstract and intro state the same stakes in
different words — a systems habit, because the abstract must stand alone.

> Abstract: "Modern clouds depend crucially on an extensible ecosystem of
> thousands of controllers…"
> Intro: "Modern clouds are powered by cluster managers such as Kubernetes,
> Borg, ECS and Twine."
> — Sun et al., *Anvil*, OSDI 2024

**5. The terse difficulty claim.** Nine words, one clause, no citation. The
genealogy of *why* comes one sentence later.

> "Revenue maximization in multi-parameter settings is notoriously challenging."
> — Chawla, Rezvan, Teng & Tzamos, *Buy-Many Mechanisms*, WINE 2023 (Best Paper)

**6. The premise audit.** Characterizes a whole research tradition, then names
its unstated assumption — which the paper then drops.

> "A large part of research in computer science is concerned with protocols and
> algorithms for interconnected collections of computers. The designer… always
> makes an implicit assumption that the participating computers will act as
> instructed – except, perhaps, for the faulty or malicious ones."
> — Nisan & Ronen, *Algorithmic Mechanism Design*, STOC 1999 / GEB 2001

**7. The technology trend.** Names a specific dated development. Ages fast on
purpose — it stakes a claim to a moment, not a timeless question.

> "Emerging non-volatile memory (NVM) technologies, e.g., Intel Optane
> persistent memory and future CLX-based storage devices, offer the best of
> memory and storage."
> — Zhou et al., *Trio*, SOSP 2023 (Best Paper, `verified`)

**8. Formal definition first.** The abstract itself carries notation and states
the exact quantity bounded.

> "A central object of study in optimal stopping theory is the single-choice
> prophet inequality for independent, identically distributed random variables:
> given a sequence… the goal is to choose a stopping time τ such that…"
> — Correa, Dütting, Fischer & Schewior, *Prophet Inequalities*

The contrast with Myerson (#2) is the sharpest generational shift in the corpus:
same subfield, formalism moved from §2 into the abstract.

**9. The definitional gap.** Identifies a hole in what the object is even
allowed to say — not a missing algorithm or bound.

> "Type systems typically only define the conditions under which an expression
> is well-typed, leaving ill-typed expressions formally meaningless."
> — Zhao et al., *Total Type Error Localization and Recovery with Holes*,
> POPL 2024

**Bonus — the contrarian premise.** States the reader's default assumption
flatly, then spends the section dismantling it.

> "A concurrent algorithm is usually specified with a program."
> — Lamport, *The Temporal Logic of Actions*, TOPLAS 1994

Lamport titles that introduction "Logic versus Programming", not
"Introduction", and replaces a contributions list with a rhetorical
question-and-answer.

## Community conventions, and how they differ

### The sharpest single signal: does the abstract contain notation?

**EC and theory abstracts increasingly do** — the Prophet Inequalities abstract
states the bound inline. **Systems, security and PL abstracts never do** — they
state the guarantee in prose and push every symbol past the fold.

If you cannot tell which community a draft is aimed at, look at its abstract for
a symbol. That is the tell.

### Contributions formatting is a dialect, not a maturity signal

Prose-under-a-bold-header (EC, WINE, SAGT, TreeSync) and numbered or bulleted
lists (Nisan–Ronen 1999, Anvil, Trio, CAV) have coexisted for five decades and
are stable *within* a community rather than converging.

The evidence against "bullets are just more modern": Myerson (1981) has no list
at all, Nisan–Ronen (1999) already has a four-item numbered list with
sub-bullets — and yet 2023–24 EC/WINE/SAGT papers still overwhelmingly prefer
prose. Match your target venue, not the calendar.

| Community | Contributions | Related work | Notation |
|---|---|---|---|
| EC / WINE / SAGT | Bold-italic "Our Contribution", prose, forward-referencing theorem numbers | **Front-loaded** — it *is* paragraph 2, doubling as motivation, with exact prior constants named | As-needed, or already specified in the abstract |
| AAMAS | Nested numbered ("1. … (1a)(1b)(1c)"), denser than theory | Dedicated §2, called **"Background"** not "Preliminaries" | Dedicated background section |
| OSDI / SOSP | Bulleted, sometimes **twice** — narratively mid-intro and again as a "Summary." list | Front-loaded, comparative, competitors named by product | Often none at all; formalism deferred past the worked example |
| USENIX Sec / S&P | Not fixed even within the venue — prose or bulleted | Both: named in intro, dedicated section later | Preliminaries with **bold run-in phrase headers**, densely chunked |
| POPL / CAV | Can be the same sentence as the problem statement, inline and bolded | Woven into intro with named citations | Deferred; the *program* is introduced first |

### Where the running example sits is diagnostic

This is the most useful structural observation in the corpus.

- **PL papers put a real program on page 2** — because the program *is* the
  object of study.
- **Systems papers put a real system on pages 1–2** (a ZooKeeper controller, a
  Spectre gadget) for the same reason.
- **Pure mechanism-design and game-theory papers defer or omit an example
  entirely**, because the object is already fully specified by the formal
  problem statement in the abstract.

If your paper's object is a formal structure, an early running example is
optional. If its object is a system or a program, its absence is conspicuous.

### "Limitations" is a systems/security convention, not a theory one

**No theory paper in this corpus has a section titled "Limitations."** Every one
that discusses scope does it under "concluding remarks" or "open problems".
Myerson's roadmap promises "concluding comments about implementation… in §8".

This does not license omitting the honest boundary — it means naming the section
the way your venue names it. Writing "Limitations" into an EC paper reads as
foreign; omitting scope discussion from an OSDI paper reads as evasion.

### A cross-venue technique worth stealing

**Pose two decisive questions, then answer them.** Used independently by a 2024
SAGT paper (indented italic "Question 1" / "Question 2" blocks) and a 2024 CAV
paper ("Two key questions must be tackled by our approach. First,… Second,…").
Two different communities, same rhetorical technology — it is a technique, not a
house style.

**And one CAV convention worth knowing:** a bold **"Impact."** paragraph after
the contributions, narrating an *unplanned* real-world side effect of the work —
in that case a bug the certification effort found in an unrelated tool. It is a
way of reporting value the contributions list cannot claim.

## Two structures worth copying wholesale

**The EC three-beat introduction:**
1. One paragraph of general motivation.
2. One paragraph of literature genealogy naming exact prior constants and bounds
   with citations — this doubles as related work.
3. A bold "Our Contribution" header, in prose, forward-referencing the theorem
   by number rather than restating it.

**The systems double-contribution:** state the contributions narratively
mid-introduction where they carry motivation ("Challenges and contributions"),
then again as a crisp bulleted "Summary. This paper makes the following
contributions:" at the end of the introduction. Readers who skim get the list;
readers who read get the argument.

## Corpus

Fifteen papers read. Award status verified where marked.

| Paper | Venue | Award |
|---|---|---|
| Myerson, *Optimal Auction Design* | Math. Oper. Res. 1981 | classic |
| Nisan & Ronen, *Algorithmic Mechanism Design* | STOC 1999 / GEB 2001 | classic |
| Lamport, *The Temporal Logic of Actions* | TOPLAS 1994 | classic |
| Hoare, *An Axiomatic Basis…* | CACM 1969 | classic; **primary text not retrieved — treat its opening as `probable`** |
| *TreeSync* | USENIX Sec 2023 | Distinguished (`probable`) |
| *Typing High-Speed Crypto against Spectre v1* | IEEE S&P 2023 | Distinguished (`probable`) |
| *Anvil* | OSDI 2024 | Jay Lepreau Best Paper (`probable`) |
| *Ensō* | OSDI 2023 | award status unconfirmed |
| *Trio / ArckFS* | SOSP 2023 | Best Paper (`verified`) |
| *Prophet Inequalities from an Unknown Distribution* | EC / MOR | **award claim conflicts with the paper's own dating — unconfirmed** |
| *Buy-Many Mechanisms for Many Unit-Demand Buyers* | WINE 2023 | Best Paper (`verified`) |
| *Swim till You Sink* | SAGT 2024 | Best Paper (`verified`) |
| *Soft Condorcet Optimization* | AAMAS 2025 | Best Paper (`probable`) |
| *Formally Certified Approximate Model Counting* | CAV 2024 | Distinguished (`verified`) |
| *Total Type Error Localization and Recovery with Holes* | POPL 2024 | Distinguished (`probable`) |
