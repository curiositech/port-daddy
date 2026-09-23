---
license: Apache-2.0
name: applied-cognitive-task-analysis-acta
description: >-
  Systematic methodology for eliciting, representing, and operationalizing expert cognitive skills—pattern recognition,
  situation assessment, mental simulation—from practitioners without requiring research training. Bridges academic rigor
  and practical usability.
metadata:
  category: Cognitive Science & Decision Making
  tags:
    - acta
    - cognitive-task-analysis
    - methodology
    - expertise
    - knowledge-capture
  io-contract:
    kind: deliverable
    produces:
      - kind: interview-guide
        description: >-
          Structured decision-tree and probe sequences for eliciting expert cognitive skills through incident-grounded
          questioning, with detection signals for vague responses and pivot strategies
        format: markdown
      - kind: cognitive-demands-table
        description: >-
          Populated analysis of difficult task elements, explanations of why they demand expertise, and extracted
          cues/strategies that experts use to navigate them
        format: json
      - kind: knowledge-audit-framework
        description: >-
          Diagnostic checklist mapping expert response patterns to cognitive dimensions (perceptual skills, mental
          simulation, situational awareness, improvisation, metacognition) with targeted probe templates
        format: markdown
      - kind: failure-mode-prevention-plan
        description: >-
          Diagnostic criteria and corrective actions for common ACTA pitfalls (rubber-stamp elicitation, single-expert
          bias, transcript worship, comprehensiveness paralysis, proceduralization fantasy)
        format: markdown
---

# SKILL: Applied Cognitive Task Analysis (ACTA) Methodology

**Name**: ACTA — Extracting and Applying Expert Cognitive Knowledge
**Description**: Systematic methodology for eliciting, representing, and operationalizing expert cognitive skills—pattern recognition, situation assessment, mental simulation—from practitioners without requiring research training. Bridges academic rigor and practical usability.

## DECISION POINTS

### Expert Response Pattern → Interview Pivot Strategy

| Expert Response Type | Detection Signal | Next Probe Action |
|---------------------|-----------------|-------------------|
| **Vague Generalization** | "You develop a feel for it" / "Experience teaches you" | → Incident Grounding: "Walk me through the last time you..." |
| **Procedural Recitation** | "First I do X, then Y, then Z..." | → Cognitive Dimension Probe: "What tells you it's time for the next step?" |
| **Abstract Principles** | "Always prioritize safety" / "Focus on the customer" | → Contrastive Example: "Show me two cases—one where that applies, one where it doesn't" |
| **Contradicts Other Expert** | "Never do X" (when Expert 2 said "Always X") | → Conditional Exploration: "Under what circumstances is X appropriate?" |
| **Describes Outcomes** | "Then the system works better" / "Quality improves" | → Cue Detection: "What do you notice that tells you it's working?" |

### Knowledge Audit Dimension Selection

```
IF expert mentions "seeing patterns" or "noticing things"
  THEN probe Perceptual Skills
    → "Show me two X's—one normal, one problematic. What differs?"

IF expert mentions "figuring out what happened" or "predicting outcomes"  
  THEN probe Mental Simulation
    → "What must have happened for..." / "If you did X, what would result?"

IF expert mentions "keeping track of multiple factors" or "big picture"
  THEN probe Situational Awareness
    → "What relationships do you monitor?" / "What trends matter?"

IF expert mentions "when standard procedures don't work"
  THEN probe Improvisation
    → "Tell me about a time the SOP failed" / "How do you adapt?"

IF expert mentions "knowing when you're wrong" or "second-guessing"
  THEN probe Metacognition
    → "How do you catch your own mistakes?" / "When do you seek help?"
```

### Cognitive Demands Table Population Strategy

```
Difficult Element Identification:
  IF multiple experts struggle to articulate the same aspect
    THEN high cognitive demand
  IF novices consistently fail here despite training
    THEN expertise-dependent element
  IF standard procedures break down in this area
    THEN cognitive skill required

Why Difficult Analysis:
  IF novices miss perceptual cues → "Lacks pattern recognition for..."
  IF novices apply wrong strategy → "Cannot distinguish situation types..."  
  IF novices tunnel vision → "Focuses on single factor instead of..."
  IF novices freeze up → "No mental model for..."

Cues/Strategies Extraction:
  IF expert says "I just know" → probe for specific observable indicators
  IF expert gives multiple approaches → identify situational triggers
  IF expert mentions "experience" → extract pattern exemplars
```

## FAILURE MODES

### **Rubber Stamp Elicitation**
**Detection**: Expert interviews produce only procedural descriptions or textbook answers. No cognitive insights emerge.
**Symptoms**: Transcripts read like SOPs. Experts say "just follow the process." No mention of judgment, adaptation, or situational factors.
**Root Cause**: Abstract questioning triggers rationalized responses, not actual expert reasoning.
**Fix**: Switch to incident-based probing. "Walk me through the last time you encountered..." Ground all questions in specific scenarios.

### **Single Expert Oracle**
**Detection**: Design decisions based on one expert's approach treated as universal truth.
**Symptoms**: "The expert says always do X" without conditional reasoning. No variation documented across experts.
**Root Cause**: Treating individual expertise as domain expertise. Missing situational dependencies.
**Fix**: Interview 3-5 experts. When approaches conflict, probe conditionals: "Under what circumstances would you do it differently?"

### **Transcript Worship**
**Detection**: Raw interview notes treated as final deliverable. No transformation to actionable representation.
**Symptoms**: Hours of interview audio with no structured output. Analysis stops at "we captured their knowledge."
**Root Cause**: Confusing data collection with knowledge extraction.
**Fix**: Force transformation through Cognitive Demands Table. Cannot complete without identifying difficult aspects, explaining why difficult, extracting cues/strategies.

### **Comprehensiveness Paralysis**
**Detection**: Project stalled waiting for "complete" expertise capture before building anything.
**Symptoms**: Endless additional interviews. "We need to understand everything first." No deployment timeline.
**Root Cause**: Perfectionism prevents pragmatic deployment. Academic standards applied to practical problems.
**Fix**: Extract sufficient expertise for initial capabilities. Deploy with monitoring and iteration cycles. 70% coverage enables valuable applications.

### **Proceduralization Fantasy**
**Detection**: Attempts to convert expert judgment into decision trees or rule sets.
**Symptoms**: Complex branching logic that doesn't capture actual expert reasoning. Rules that break in novel situations.
**Root Cause**: Treating expertise as refined procedure rather than pattern recognition.
**Fix**: Build pattern classification and situation assessment capabilities. Focus on "What kind of situation is this?" not "What's the prescribed action?"

## WORKED EXAMPLES

### Example 1: Emergency Nurse Triage

**Context**: Hospital needs to improve triage accuracy. Nurses with 2+ years experience significantly outperform new graduates in patient priority assignment.

**Task Diagram Phase**:
Initial interview reveals standard triage procedure: vital signs → protocol lookup → priority assignment. But experts mention "something doesn't look right" decisions that novices miss.

**Knowledge Audit Phase**:
*Probe*: "Show me two patients with similar vital signs—one you'd fast-track, one you wouldn't."
*Expert Response*: "This one [points to case] has normal BP and pulse, but look at the skin color and how she's positioning herself. See how she's leaning forward? That's respiratory distress compensation."
*Follow-up*: "What would a new nurse miss?"
*Expert Response*: "They'd see normal vitals and send her to regular queue. They don't recognize the positioning pattern or skin color changes."

**Simulation Interview**:
Present scenario: 45-year-old male, chest pain, normal vitals, says "feels like heartburn."
*Expert Response*: "I'd ask about radiation to jaw or left arm. Also look at diaphoresis—sweating pattern. Men often minimize cardiac symptoms. Even with normal vitals, the description pattern raises MI risk."

**Cognitive Demands Table Output**:
| Difficult Element | Why Difficult | Cues/Strategies |
|------------------|---------------|-----------------|
| Detecting compensated respiratory distress | Vitals appear normal due to physiological compensation | Forward-leaning posture, pursed lips, skin color changes, accessory muscle use |
| Recognizing atypical cardiac presentations | Standard symptom descriptions don't match textbook | Male minimization patterns, "heartburn" descriptions with diaphoresis, jaw/arm radiation |

**Agent Capability Mapping**:
- Pattern recognition system trained on posture/positioning data
- Skin color analysis in combination with vital trends  
- Natural language processing for symptom description patterns
- Risk stratification that weights behavioral cues alongside physiological measures

**Trade-off Analysis**: Visual pattern recognition requires camera systems vs. privacy concerns. Behavioral cue detection needs training data vs. patient consent. Expert pattern recognition operates on multi-modal inputs that are technically challenging but clinically critical.

### Example 2: Manufacturing Safety Inspection

**Context**: Chemical plant needs to improve pre-startup safety checks. Experienced inspectors catch hazards that procedural checklists miss.

**Task Diagram Phase**:
Standard inspection covers 47 checklist items across systems. But senior inspectors mention "intuitive" hazard detection that prevents incidents.

**Knowledge Audit Phase**:
*Probe*: "Walk me through the last time you found something not on the checklist."
*Expert Response*: "Pump was running within specs, pressure normal, but the vibration pattern felt different. Not louder—different frequency. Turned out bearing was starting to fail. Would've gone catastrophic during the run."
*Follow-up*: "How do you know normal vibration patterns?"
*Expert Response*: "After 15 years, you feel how each pump runs. This one usually has a smooth hum. That day it had a slight roughness underneath."

**Simulation Interview**:
Present scenario: All checklist items pass, but unusual smell in Unit 3.
*Expert Response*: "I'd trace the smell. Chemical odors shouldn't penetrate the building envelope. Either we have a leak that isn't registering on sensors, or ventilation system failure. Both are serious even if readings look normal."

**Cognitive Demands Table Output**:
| Difficult Element | Why Difficult | Cues/Strategies |
|------------------|---------------|-----------------|
| Detecting equipment degradation before sensor alerts | Requires learned baselines for normal operation patterns | Vibration frequency changes, sound pattern shifts, subtle performance variations |
| Identifying containment failures through sensory cues | Chemical detection systems have lag time and blind spots | Odor tracing, airflow pattern assessment, correlation with environmental conditions |

**Agent Capability Mapping**:
- Vibration analysis with learned baselines for each equipment piece
- Chemical sensor networks with pattern recognition for anomalous readings
- Environmental monitoring that correlates multiple sensory inputs
- Predictive maintenance algorithms that weight subtle degradation indicators

**Trade-off Analysis**: Sensor density vs. cost considerations. Learned baselines require operational history vs. new equipment deployment. Human sensory integration (smell, vibration, sound) difficult to replicate technically but critical for early hazard detection.

## Reference Files

- `diagrams/01_flowchart_acta_elicitation_protocol_deci.md` — Decision tree routing expert response patterns (abstract/concrete/procedural) to appropriate elicitation method. **Read when** designing interview structure or deciding which probe technique to deploy.

- `diagrams/02_mindmap_cognitive_dimensions_of_expert.md` — Five cognitive dimensions (perceptual discrimination, mental simulation, situational awareness, improvisation, metacognition) with cues, behaviors, agent capabilities, and novice failure modes. **Read when** mapping expert skills to agent design requirements.

- `diagrams/03_erDiagram_cognitive_demands_table_schema.md` — Entity-relationship model linking scenarios, difficulty reasons, expert cues/strategies, cognitive dimensions, and agent capabilities. **Read when** structuring the cognitive demands table or understanding data relationships.

- `references/cognitive-demands-table-as-integration-tool.md` — Explains how the cognitive demands table transforms 50–75 pages of interview notes into actionable design decisions for non-experts. **Read when** populating or interpreting the cognitive demands table.

- `references/expertise-as-pattern-recognition-not-procedure.md` — Core insight: experts see different problems, not execute better procedures. Fireground commander example. **Read when** designing probes to elicit perceptual cues rather than procedural steps.

- `references/extracting-expertise-through-structured-probes.md` — Knowledge Audit framework: six fundamental dimensions and systematic probe templates for tacit knowledge. **Read when** conducting knowledge audit interviews or designing probe sequences.

- `references/failure-modes-in-knowledge-elicitation.md` — Five predictable failure modes: surface-level capture, single-expert bias, transcript worship, comprehensiveness paralysis, proceduralization fantasy. **Read when** diagnosing why elicitation feels incomplete or designing safeguards.

- `references/simulation-based-expertise-elicitation.md` — Simulation Interview method: present challenging scenario, ask expert to narrate reasoning in real time. Solves context problem. **Read when** expert gives vague generalities or procedural checklists instead of situated cognition.

- `references/when-streamlined-methods-suffice.md` — Pragmatic epistemology: when full academic CTA is overkill; when streamlined ACTA produces "good enough" results for practical applications. **Read when** deciding scope and depth of analysis.

## QUALITY GATES

**Cognitive Demands Table Completion**:
- [ ] Each "Difficult Element" appears in multiple expert interviews (not individual quirks)
- [ ] "Why Difficult" explanations are observable/testable (not circular reasoning like "requires experience")
- [ ] "Cues/Strategies" are specific enough for training design (not vague like "pattern recognition")
- [ ] Expert consensus reached on major cognitive demands (3+ experts validate core elements)
- [ ] Agent can classify novel scenarios using identified cues (testable discrimination)
- [ ] Novice failure modes mapped to specific cognitive gaps (not just "lack of training")

**Interview Quality Assessment**:
- [ ] Expert provided specific incidents, not just general principles
- [ ] Cognitive dimensions probed systematically (perception, simulation, awareness, etc.)
- [ ] Conflicting expert responses resolved through conditional exploration
- [ ] Context-dependent reasoning captured (when to use different strategies)
- [ ] Tacit knowledge made explicit through structured probes

**Practical Usability Validation**:
- [ ] Non-experts can use table for training design without attending interviews
- [ ] Agent specifications derivable from cue/strategy descriptions
- [ ] Failure modes predictable from "why difficult" analysis
- [ ] Knowledge portable across similar domains/applications

## NOT-FOR BOUNDARIES

**Do NOT use ACTA for**:
- **Simple procedural tasks**: If experts just follow procedures faster, use process improvement methods instead
- **Well-documented domains**: If expertise is already captured in accessible form, focus on transfer/training optimization
- **Individual skill coaching**: For developing one person's expertise, use mentoring or deliberate practice approaches
- **Academic research requirements**: If you need publication-quality rigor, use full Cognitive Task Analysis methods
- **Real-time performance support**: For in-the-moment assistance, use job aids or decision support systems

**Delegate instead to**:
- **Process mapping** → for procedural optimization
- **Training design specialists** → for curriculum development from ACTA outputs  
- **Domain modeling** → for comprehensive knowledge representation
- **Ethnographic methods** → for cultural/organizational expertise factors
- **Psychometric assessment** → for individual aptitude measurement

**ACTA specifically addresses**: Extracting cognitive expertise that enables superior pattern recognition, situation assessment, and adaptive problem-solving for training design and agent specification purposes.