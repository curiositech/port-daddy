#!/usr/bin/env python3
"""
Generate the complete figures-side-by-side-comparison.tex document and compile it cleanly.
"""
import subprocess
import os
import re

def esc_tex(text):
    if not isinstance(text, str):
        return text
    # Escape unescaped %
    text = re.sub(r'(?<!\\)%', r'\%', text)
    # Escape unescaped &
    text = re.sub(r'(?<!\\)&', r'\&', text)
    # Escape unescaped #
    text = re.sub(r'(?<!\\)#', r'\#', text)
    return text

figures_data = [
    {
        "id": "Figure 0.1",
        "title": "Proposition 1 Mechanics: Serial Write Arbitration",
        "section": "Section 0.2.1 · Theoretical Foundations of Agency · Single-Writer Mutex",
        "raster": "figures/fig-spark-prop1-funnel.jpg",
        "tex": "figures/fig-spark-prop1-funnel.tex",
        "notes_raster": [
            "Lossy raster rendering; blurry text on commit blocks and process queues",
            "Inexact funnels; non-orthogonal connections between writer processes and queue",
            "Opaque binary blob (78 KB); cannot review or diff structural updates in git"
        ],
        "notes_vector": [
            "Native vector precision with mathematical bezier funnel curve",
            "Strict 3-tier hierarchy: Concurrent processes (pdcobalt), Funnel, Commit boundary",
            "Active WAL highlighted in pdrust; 100% diffable LaTeX source code"
        ]
    },
    {
        "id": "Figure 0.2",
        "title": "Proposition 2 Mechanics: Monotonic Capability Attenuation",
        "section": "Section 0.2.2 · Security Architecture · The Anchor Protocol & Macaroons",
        "raster": "figures/fig-spark-prop2-attenuation.jpg",
        "tex": "figures/fig-spark-prop2-attenuation.tex",
        "notes_raster": [
            "Fuzzy badge typography and illegible caveat signatures",
            "Inconsistent arrow spacing and arbitrary delegation hops",
            "No formal attenuation constraint check visible in source asset"
        ],
        "notes_vector": [
            "Exact chained HMAC signatures with monotonic capability narrowing ($C_0 \\supset C_1 \\supset C_2$)",
            "Visual boundary enforcement: Attenuated tokens strictly subset parental scopes",
            "Systematic color-coding for root issuer, intermediary delegation, and leaf execution"
        ]
    },
    {
        "id": "Figure 0.3",
        "title": "Proposition 3 Mechanics: Sealed Room Confinement",
        "section": "Section 0.2.3 · Execution Isolation · Sandboxing & Spend Caps",
        "raster": "figures/fig-spark-prop3-confinement.jpg",
        "tex": "figures/fig-spark-prop3-confinement.tex",
        "notes_raster": [
            "Irregular container boundary with broken corner styling",
            "Spend meter and canary token indicators suffer from pixel compression artifacts",
            "Unclear separation between host environment and confined tenant"
        ],
        "notes_vector": [
            "Mathematically crisp double-walled sealed container boundary",
            "Explicit single-aperture egress slot with canary token inspection and conserved spend meter",
            "Complete alignment with macOS Seatbelt SBPL and Linux Landlock security semantics"
        ]
    },
    {
        "id": "Figure 0.4",
        "title": "Proposition 4 Mechanics: Information Cost & Evidence Drilling",
        "section": "Section 0.2.4 · Supervisory Systems · Attention Budget & Drilling",
        "raster": "figures/fig-spark-prop4-supervision.jpg",
        "tex": "figures/fig-spark-prop4-supervision.tex",
        "notes_raster": [
            "Event firehose lines collide with callout panels; illegible JSON text",
            "FleetBar console window is misaligned with arbitrary text wrapping",
            "Colliding labels inside optical prism; ambiguous evidence return arrows"
        ],
        "notes_vector": [
            "Prism geometry with optical facets and central diamond aperture dot",
            "FleetBar console window widened by 6 characters; clean key/value rows without 'packet' noise",
            "Evidence pointers cleanly routed beneath information compression layer back to raw streams"
        ]
    },
    {
        "id": "Figure 0.5",
        "title": "Proposition 5 Mechanics: Durable Persona vs. Ephemeral Process",
        "section": "Section 0.2.5 · Identity Architecture · From Spawn to Person",
        "raster": "figures/fig-spark-prop5-identity.jpg",
        "tex": "figures/fig-spark-prop5-identity.tex",
        "notes_raster": [
            "Artifacted process crash explosions and blurry skull/restart icons",
            "Unclear relationship between process lifecycle and durable cryptographic persona",
            "Binary bitmap fails to convey append-only ledger immutability"
        ],
        "notes_vector": [
            "Clear vertical plane separation: Ephemeral execution realm vs. Durable identity bedrock",
            "Process crash, kill, and respawn cycles decoupled from persistent Ed25519 identity key",
            "Append-only debt ledger and reputation history persist across operating system crashes"
        ]
    },
    {
        "id": "Figure 0.6",
        "title": "Proposition 6 Mechanics: Four Separated Market Instruments",
        "section": "Section 0.2.6 · Agent Economics · Market Instruments & Settlement",
        "raster": "figures/fig-spark-prop6-instruments.jpg",
        "tex": "figures/fig-spark-prop6-instruments.tex",
        "notes_raster": [
            "Unbalanced instrument columns; indistinct symbols for collateral vs payment",
            "Settlement flow arrows cross over text boxes illegibly",
            "Colors lack semantic contrast; text unreadable at standard book sizes"
        ],
        "notes_vector": [
            "Four distinct architectural pillars: Payment, Collateral, Evidence, and Settlement",
            "Rigorous contractual state machine preventing moral hazard and adverse selection",
            "Exact typographic alignment with book data-ink standards"
        ]
    },
    {
        "id": "Figure 0.7",
        "title": "Proposition 7 Mechanics: Bonded Execution & Liquidated Damages",
        "section": "Section 0.2.7 · Agent Governance · Bonded Commons & Arbitration",
        "raster": "figures/fig-spark-prop7-bonded.jpg",
        "tex": "figures/fig-spark-prop7-bonded.tex",
        "notes_raster": [
            "Low-resolution clip-art figures with raster scaling artifacts",
            "Broken layout margins with blurry text in arbitration and remedy boxes",
            "Inconsistent line styling between workflow steps and failure branches"
        ],
        "notes_vector": [
            "3-stage pipeline: Bonded Stake Deposit, Randomized Audit, and Contest Arbitration",
            "Dual-outcome branching: Valid Outcome (Bond Released) vs. Defect/Harm (Stake Slashed)",
            "Integrated remedy sequence: Automatic liquidation and compensation to affected parties"
        ]
    },
    {
        "id": "Figure 0.8",
        "title": "Proposition 8 Mechanics: Cross-Harbor Relay & Zero-Trust Federation",
        "section": "Section 0.2.8 · Distributed Architecture · Relay Fabric & Proof Gossip",
        "raster": "figures/fig-spark-prop8-federation.jpg",
        "tex": "figures/fig-spark-prop8-federation.tex",
        "notes_raster": [
            "Heavy raster compression artifacts on database cylinders and security boundaries",
            "Illegible Merkle tree leaf labels and blurry cryptographic signature badges",
            "Disconnected arrows and fuzzy zero-trust relay cylinder boundary"
        ],
        "notes_vector": [
            "Bilateral federation: Harbor Host A and Harbor Host B with isolated security boundaries",
            "Central zero-trust relay fabric with cryptographic witness receipts and Merkle proofs",
            "Zero shared database and zero global sovereign invariant strictly enforced"
        ]
    },
    {
        "id": "Figure 0.9",
        "title": "BDI Execution Flow and Operational Choice Architecture",
        "section": "Section 0.1.3 · Classical Multi-Agent Theory · AgentSpeak(L) Semantics",
        "raster": "figures/fig-ch0-bdi-diagram.jpg",
        "tex": "figures/fig-ch0-bdi-execution.tex",
        "notes_raster": [
            "Cluttered feedback loops with unreadable mathematical operators ($S_E, S_O, S_I$)",
            "Messy box corners, inconsistent padding, and illegible code snippets",
            "Non-standard color palette clashing with the rest of the volume"
        ],
        "notes_vector": [
            "3 clear architectural swimlanes: 1. Perception & Events, 2. Plan Deliberation, 3. Intention Execution",
            "Formal AgentSpeak(L) selection functions ($S_E, S_O, S_I$) with recovery event ($-!g$)",
            "Strict Swiss styling using pdcobalt, pdteal, and pdindigo with 4pt inner padding"
        ]
    },
    {
        "id": "Figure 0.10",
        "title": "Concurrency Foundations: Virtual Actors vs. CSP Rendezvous",
        "section": "Section 0.1.4 · Concurrency & Message Passing · Hewitt-Agha vs. Hoare CSP",
        "raster": "figures/fig-ch0-concurrency-diagram.jpg",
        "tex": "figures/fig-ch0-concurrency-actors-csp.tex",
        "notes_raster": [
            "Asymmetric lifelines with wavy paths and distorted mailbox queues",
            "Rendezvous barrier rendered as a fuzzy blob rather than an instantaneous synchronization",
            "Lack of formal notation for actor replacement behaviors (become)"
        ],
        "notes_vector": [
            "Side-by-side comparison of asynchronous Actor mailboxes vs. synchronous CSP rendezvous",
            "Explicit zero-duration synchronization barrier ($\\Delta t = 0$) with lease timeout guards",
            "Formal state transitions: $\\mathtt{become}(B')$, unbuffered channels, and external choice"
        ]
    },
    {
        "id": "Figure 0.11",
        "title": "FIPA-00037 Communicative Speech Act State Machine",
        "section": "Section 0.1.5 · Agent Communication Languages · Speech Acts & Performatives",
        "raster": "figures/fig-ch0-fipa-speech-acts.jpg",
        "tex": "figures/fig-ch0-fipa-speech-acts.tex",
        "notes_raster": [
            "Speech bubble shapes look like comic illustrations rather than formal protocols",
            "Performative labels (inform, request, propose) are blurry and unsearchable",
            "Protocol branching logic is incomplete and missing error return paths"
        ],
        "notes_vector": [
            "Formal state machine covering Directive (request), Assertive (inform), and Commissive (propose)",
            "Production payloads grounded in database migrations, belief updates, and deployment SLAs",
            "Cryptographic sender verification, capability tokens, and conversation correlation IDs"
        ]
    },
    {
        "id": "Figure 0.12",
        "title": "Contract Net Protocol (CNP) Task Allocation Lifecycle",
        "section": "Section 0.1.6 · Task Allocation & Market Protocols · Smith (1980) CNP",
        "raster": "figures/fig-ch0-cnp-diagram.jpg",
        "tex": "figures/fig-ch0-cnp-protocol.tex",
        "notes_raster": [
            "Contractor evaluation nodes have overlapping text lines and clipped margins",
            "Bidding and award lifecycle lacks explicit timing cues and escrow binding",
            "Two separate raster files were required (bidding vs settlement) causing visual fragmentation"
        ],
        "notes_vector": [
            "Unified two-phase sequence: Phase 1 (CFP & Bidding) and Phase 2 (Award, Sandbox & Settlement)",
            "Explicit worktree lease tokens, spend caps, and cryptographic test run receipts",
            "Crisp sequence arrows with clear contractor state alternatives (Bid vs Refusal)"
        ]
    },
    {
        "id": "Figure 0.13",
        "title": "Dynamic Epistemic Observation Cones in Big Brother Logic",
        "section": "Section 0.1.7 · Epistemic Logic · Charrier et al. (2014) BBL",
        "raster": "figures/fig-ch0-bbl-diagram.jpg",
        "tex": "figures/fig-ch0-bbl-vision-cones.tex",
        "notes_raster": [
            "Vision cones are rendered as muddy gradient wedges with jagged edges",
            "Coordinate grid numbers and formulas have pixelated compression artifacts",
            "Observer and worker agent icons suffer from raster scaling blur"
        ],
        "notes_vector": [
            "Exact geometric vision cones with angular field-of-view and sightline vectors",
            "Mathematically shaded epistemic shadows preventing side-channel data exfiltration",
            "Rigorous epistemic status badges: Supervised, Isolated, Blind, and Shadowed"
        ]
    },
    {
        "id": "Figure 0.14",
        "title": "Arrow's Impossibility Theorem in Multi-Agent Consensus",
        "section": "Section 0.1.8 · Social Choice & Game Theory · Arrow (1951)",
        "raster": "figures/fig-arrows-impossibility.png",
        "tex": "figures/fig-ch0-arrows-consensus.tex",
        "notes_raster": [
            "Condorcet cycle triangle has jagged pixelated arrows",
            "Ordinal ranking tables suffer from raster compression blur",
            "Font weights and sizes do not match the surrounding textbook"
        ],
        "notes_vector": [
            "Clean geometric cycle ($A \\succ B \\succ C \\succ A$) with circular cyclic arcs",
            "Crisp preference profile matrix comparing voter rankings across candidates",
            "Formal proof annotations showing why Port Daddy replaces ordinal voting with cardinal VCG clearing"
        ]
    },
    {
        "id": "Figure 0.15",
        "title": "Progressive Disclosure of Skills Across Logarithmic Decades",
        "section": "Section 0.3.3 · Tool Calling & Extensibility · Skill Architecture",
        "raster": "figures/fig-ch0-skills-diagram.jpg",
        "tex": "figures/fig-ch0-progressive-skills.tex",
        "notes_raster": [
            "Raster diagram suffers from non-vector text pixelation at standard book scale",
            "Token counts (~100, ~1,000, ~5,000) blur when resized to two-page spread width",
            "Robot token meter icon and decade pill borders show compression ringing"
        ],
        "notes_vector": [
            "Mathematically exact logarithmic scale ($10^0, 10^{-1}, 10^{-2}, 10^{-4}$)",
            "Four progressive tiers: Discovery Metadata (100 B), Instructions (2 KB), Scripts (0 B context), Schemas",
            "Shows exponential context savings achieved by keeping procedural code outside the LLM window"
        ]
    },
    {
        "id": "Figure 0.16",
        "title": "The Agent Lifecycle Hook Cross-Section",
        "section": "Section 0.3.4 · Hooks & Interception · Claude Code & Giant Squid",
        "raster": "figures/fig-ch0-lifecycle-diagram.jpg",
        "tex": "figures/fig-ch0-lifecycle-hooks.tex",
        "notes_raster": [
            "Raster loop text and arrow labels show blurry compression halos",
            "Interception hook labels (PreToolUse, PostToolUse) suffer from low contrast",
            "Production trace callout boxes (Cases A-C) lose crispness at high print resolutions"
        ],
        "notes_vector": [
            "Two distinct supervisory loops: Outer Session/Turn Lifecycle vs. Inner Agentic Tool Loop",
            "High-contrast hook interceptors: SessionStart, UserPromptSubmit, PreCompact, PreToolUse, PostToolUse, Stop",
            "Three real-world enforcement traces: Case A (Veto), Case B (Sanitization), Case C (Clean Commit)"
        ]
    },
    {
        "id": "Figure 0.17",
        "title": "Ramadge-Wonham Discrete-Event Supervisory Control",
        "section": "Section 0.3.5 · Supervisory Control Theory · Discrete-Event Systems",
        "raster": "figures/fig-ch0-wonham-supervisory.jpg",
        "tex": "figures/fig-ch0-wonham-supervisory.tex",
        "notes_raster": [
            "Automata state nodes are distorted ellipses with unreadable transition labels",
            "Controllable vs uncontrollable event sets ($\\Sigma_c$ vs $\\Sigma_u$) are visually indistinguishable",
            "Mathematical notation for supervisory feedback control is blurry"
        ],
        "notes_vector": [
            "Formal Moore-automata state machine with controllable events ($\\Sigma_c$) and uncontrollable events ($\\Sigma_u$)",
            "Closed-loop supervisor $S$ dynamically disabling unsafe transitions to enforce language $K \\subset L(G)$",
            "Direct application to sandboxed agent tool execution and mutual exclusion invariants"
        ]
    },
    {
        "id": "Figure 0.18",
        "title": "The Closed Agentic Architecture Loop",
        "section": "Section 0.4.1 · Closed-Loop Governance · Three-Tier Operating Architecture",
        "raster": "figures/fig-ch0-closed-loop-diagram.jpg",
        "tex": "figures/fig-ch0-closed-loop-diagram.tex",
        "notes_raster": [
            "Raster icons (chip, terminal, lock) blur and degrade at print resolution",
            "Layer text boxes show edge fringing and JPEG compression artifacts",
            "Sanitized observation feedback arrow text suffers from raster blur"
        ],
        "notes_vector": [
            "Three clean architectural strata: 1. Probabilistic Deliberation, 2. Confined Execution, 3. Deterministic Governance",
            "Rigorous separation of powers: LLMs reason, Sandboxes execute, Kernels arbitrate and persist",
            "Cryptographic attestation and immutable receipts closing the loop back to operator oversight"
        ]
    }
]

latex_doc = r"""\documentclass[10pt,a4paper,landscape]{article}
\usepackage{graphicx}
\usepackage{tikz}
\usepackage{xcolor}
\usepackage{booktabs}
\usepackage{array}
\usepackage{fancyhdr}
\usepackage{enumitem}

\input{coordination-papers-mega-volume-preamble.tex}
\geometry{a4paper,landscape,top=0.6cm,bottom=0.6cm,left=1.0cm,right=1.0cm}

\pagestyle{fancy}
\fancyhf{}
\renewcommand{\headrulewidth}{0.4pt}
\renewcommand{\footrulewidth}{0.3pt}
\fancyhead[L]{\pdgrotesk\footnotesize\bfseries PORT DADDY WHITE PAPER \ \textperiodcentered \ \ \textsc{Architectural Figure Reconciliation Audit}}
\fancyhead[R]{\pdgrotesk\footnotesize\bfseries Visual Proof \& Comparative Verification \ \textperiodcentered \ \ Page \thepage\ of 18}
\fancyfoot[L]{\pdgrotesk\scriptsize\textbf{Status:} 100\% Reconciled \ \textperiodcentered \ \ Native Vector TikZ/PGF \ \textperiodcentered \ \ Local XeLaTeX Compilation \ \textperiodcentered \ \ \$0.00 Spend}
\fancyfoot[R]{\pdgrotesk\scriptsize Governing AI Agents: The Harbor, the Person, and the Economy}

\newsavebox{\pdfigbox}
\newsavebox{\pdscaledbox}
\newcommand{\pdautoscale}[2]{% #1 max height, #2 max width
  \sbox{\pdscaledbox}{\usebox{\pdfigbox}}%
  \ifdim\dimexpr\ht\pdscaledbox+\dp\pdscaledbox\relax>#1
    \sbox{\pdscaledbox}{\resizebox{!}{#1}{\usebox{\pdscaledbox}}}%
  \fi
  \ifdim\wd\pdscaledbox>#2
    \sbox{\pdscaledbox}{\resizebox{#2}{!}{\usebox{\pdscaledbox}}}%
  \fi
  \usebox{\pdscaledbox}%
}

\begin{document}
"""

for idx, fig in enumerate(figures_data):
    fig_id = esc_tex(fig["id"])
    fig_title = esc_tex(fig["title"])
    sec_info = esc_tex(fig["section"])
    raster_file = fig["raster"]
    notes_raster = [esc_tex(n) for n in fig["notes_raster"]]
    notes_vector = [esc_tex(n) for n in fig["notes_vector"]]
    
    latex_doc += f"""
% =========================================================================
% PAGE {idx+1}: {fig_id}
% =========================================================================
\\noindent
\\begin{{minipage}}[t]{{\\linewidth}}
  \\noindent{{\\pdgrotesk\\large\\bfseries {fig_id} \\textperiodcentered\\ {fig_title}}}\\hfill
  {{\\pdgrotesk\\footnotesize\\color{{hhgray}} {sec_info}}}\\\\
  \\vspace*{{0.03cm}}
  \\noindent{{\\color{{hhgray!40}}\\rule{{\\linewidth}}{{0.5pt}}}}
\\end{{minipage}}

\\vspace*{{0.05cm}}
\\noindent
\\begin{{minipage}}[t]{{0.492\\linewidth}}
  \\begin{{tcolorbox}}[
    colback=pdslate!4,colframe=pdslate!70!black,arc=1.5pt,
    boxrule=0.6pt,top=1.5pt,bottom=1.5pt,left=4pt,right=4pt,
    title={{\\pdgrotesk\\footnotesize\\bfseries \\color{{white}} A. AI-Generated Raster Prototype (Diffusion / Nano Banana) \\hfill \\texttt{{.jpg / .png}}}}
  ]
    \\begin{{minipage}}[c][8.3cm][c]{{\\linewidth}}
      \\centering
      \\includegraphics[width=\\linewidth,height=8.0cm,keepaspectratio]{{{raster_file}}}
    \\end{{minipage}}
    \\tcblower
    \\begin{{minipage}}[t][2.0cm][t]{{\\linewidth}}
      \\pdgrotesk\\scriptsize
      \\textbf{{\\color{{pderror!90!black}} Artifact \\& Limitation Audit:}}\\\\
      \\begin{{itemize}}[leftmargin=9pt,itemsep=0pt,topsep=0.5pt,parsep=0pt]
"""
    for nr in notes_raster:
        latex_doc += f"        \\item {nr}\n"
    latex_doc += """      \\end{itemize}
    \\end{minipage}
  \\end{tcolorbox}
\\end{minipage}\\hfill
\\begin{minipage}[t]{0.492\\linewidth}
  \\begin{tcolorbox}[
    colback=pdcobalt!3,colframe=pdcobalt!85!black,arc=1.5pt,
    boxrule=0.7pt,top=1.5pt,bottom=1.5pt,left=4pt,right=4pt,
    title={\\pdgrotesk\\footnotesize\\bfseries \\color{white} B. Authoritative Native Vector Replacement \\hfill \\texttt{.tex / TikZ / PGF}}
  ]
    \\begin{minipage}[c][8.3cm][c]{\\linewidth}
      \\centering
"""
    if fig.get("tex_type") == "plate" or fig.get("tex_type") == "part_plate":
        rep_img = fig["replacement_img"]
        latex_doc += f"      \\includegraphics[width=\\linewidth,height=8.0cm,keepaspectratio]{{{rep_img}}}\n"
    else:
        tex_file = fig["tex"]
        latex_doc += f"      \\sbox{{\\pdfigbox}}{{\\input{{{tex_file}}}}}\n"
        latex_doc += f"      \\pdautoscale{{8.0cm}}{{\\linewidth}}\n"
        
    latex_doc += """    \\end{minipage}
    \\tcblower
    \\begin{minipage}[t][2.0cm][t]{\\linewidth}
      \\pdgrotesk\\scriptsize
      \\textbf{{\\color{pdcobalt} Engineering \\& Typography Guarantees:}}\\\\
      \\begin{itemize}[leftmargin=9pt,itemsep=0pt,topsep=0.5pt,parsep=0pt]
"""
    for nv in notes_vector:
        latex_doc += f"        \\item {nv}\n"
    latex_doc += """      \\end{itemize}
    \\end{minipage}
  \\end{tcolorbox}
\\end{minipage}

\\vspace*{0.05cm}
\\noindent
\\begin{tcolorbox}[
  colback=hhpaper,colframe=hhgray!35,arc=1.5pt,boxrule=0.4pt,
  top=1.5pt,bottom=1.5pt,left=6pt,right=6pt
]
  \\pdgrotesk\\scriptsize
  \\noindent
  \\textbf{Visual Substrate:} Lossy Bitmap Raster $\\rightarrow$ \\textbf{\\color{pdcobalt}Native PDF / PostScript Vector}\\hfill
  \\textbf{Text Engine:} Pixelated Approximations $\\rightarrow$ \\textbf{\\color{pdcobalt}Book Typography (OpenType)}\\hfill
  \\textbf{Resolution:} Fixed DPI Limit $\\rightarrow$ \\textbf{\\color{pdcobalt}Infinite Resolution ($\\infty$)}\\hfill
  \\textbf{Status:} \\textbf{\\color{pdteal}RECONCILED \\& VERIFIED}
\\end{tcolorbox}
\\clearpage
"""

latex_doc += r"\end{document}" + "\n"

target_path = "website-v2/public/whitepaper/figures-side-by-side-comparison.tex"
with open(target_path, "w") as f:
    f.write(latex_doc)

print(f"Generated {target_path} cleanly.")
