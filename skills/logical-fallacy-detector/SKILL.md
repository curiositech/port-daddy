---
name: logical-fallacy-detector
description: >-
  Identify, label, and explain logical fallacies in arguments and discourse. Use when the user wants to analyze
  arguments, check reasoning, evaluate debate claims, spot weak arguments, do debate prep, policy writing, or conflict
  analysis. Triggers on 'fallacy', 'logical error', 'faulty reasoning', 'argument flaw', 'is this valid', 'check this
  logic'. Works on both formal deductive errors and informal reasoning mistakes.
metadata:
  io-contract:
    kind: deliverable
    produces:
      - kind: critique
        description: >-
          Structured analysis of logical fallacies in an argument, identifying category, severity, and specific textual
          evidence for each fallacy detected
        format: markdown
      - kind: refactor-plan
        description: >-
          Non-fallacious rewording or strengthening of the argument, with alternative phrasings that preserve the
          original intent
        format: markdown
      - kind: diagram
        description: Decision tree trace or argument structure visualization showing how the input was classified and evaluated
        format: markdown
license: Apache-2.0
allowed-tools: Read,Write,Edit,Glob,Grep
---

# Logical Fallacy Detector

## Fallacy Categories

### 1. Formal Fallacies
Errors in **logical structure** — the conclusion doesn't follow from premises even when they're true. Key types: affirming the consequent, denying the antecedent, undistributed middle, illicit major/minor.
→ See `references/taxonomy/formal-fallacies.md`

### 2. Relevance Fallacies
Premises are **irrelevant** to the conclusion — they distract or misdirect. Key types: ad hominem (abusive, circumstantial, tu quoque), straw man, red herring, appeal to authority, appeal to emotion, bandwagon, genetic fallacy.

### 3. Ambiguity Fallacies
Arguments exploit **unclear language** — key terms shift meaning mid-argument. Key types: equivocation, amphiboly, composition, division.

### 4. Presumption Fallacies
Arguments **assume what they need to prove** or artificially restrict options. Key types: begging the question, false dilemma, hasty generalization, slippery slope, circular reasoning, loaded question, no true Scotsman.
→ See `references/taxonomy/informal-fallacies.md`

## Decision Points

**Primary Decision Tree: Fallacy vs Non-Fallacy**
```
1. Is there a clear argument with claim + support?
   NO → Report "No argument to analyze"
   YES → Continue to 2

2. Does the support actually connect to the claim?
   NO → Check relevance fallacies (ad hominem, red herring, appeal to emotion)
   YES → Continue to 3

3. Is this a deductive argument with formal structure?
   YES → Check formal fallacies (affirming consequent, denying antecedent)
   NO → Continue to 4

4. Are key terms used consistently throughout?
   NO → Check ambiguity fallacies (equivocation, composition/division)
   YES → Continue to 5

5. Does the argument assume what it's trying to prove?
   YES → Check presumption fallacies (begging question, false dilemma, hasty generalization)
   NO → Likely sound argument, check for minor issues only
```

**Disambiguation Decision Points:**
- **Straw Man vs Red Herring**: Does the arguer misrepresent the opponent's position (straw man) OR simply change the subject entirely (red herring)?
- **Ad Hominem vs Legitimate Character Assessment**: Is the person's character actually relevant to their credibility on this specific claim?
- **False Dilemma vs Legitimate Binary**: Are there genuinely only two options, or are alternatives being artificially excluded?
- **Hasty Generalization vs Reasonable Inference**: Is the sample size adequate and representative for the scope of the conclusion?

## Detection Pipeline

1. **Identify core claim and support** — separate conclusion from emotional framing and rhetorical flourishes. Accept raw text or Toulmin-structured input from `toulmin-argument-analysis`.
2. **Category-level scan** — screen for relevance, structure, ambiguity, and presumption issues before drilling into specific names
3. **Match specific fallacy patterns** — use the taxonomy. Be conservative: only name a fallacy when the match is clear; describe weaknesses without labels when uncertain
4. **Assess severity** — Critical (fully undermines argument), Moderate (significantly weakens), Minor (imprecision, argument may survive)
5. **Produce output** — structured per format below, plus overall assessment of what survives

## Output Format

For each fallacy detected:

```
**Fallacy**: [Name]
**Category**: [Formal | Relevance | Ambiguity | Presumption]
**Explanation**: [Why this specific instance is fallacious — tied to actual text]
**Severity**: [Critical | Moderate | Minor]
**Stronger Alternative**: [A non-fallacious way to make a similar point, if one exists]
```

After all fallacies:

```
**Overall Assessment**: [Does the argument retain force after fallacies are addressed? What is salvageable?]
```

If no fallacies detected, say so clearly and explain why the argument is structurally sound (even if its premises or conclusion are disputable).

## Failure Modes

**1. Fallacy Label Spam**
- *Detection*: If you're naming 4+ fallacies in a single short argument, you're over-labeling
- *Fix*: Focus on 1–2 most severe structural flaws; describe other issues without formal labels. When uncertain whether a pattern matches, describe the weakness rather than force a name

**2. Context Blindness**
- *Detection*: Analysis ignores obvious conversational context, relationship dynamics, or implied premises
- *Fix*: Consider what's been established earlier in the conversation. Note when context might change assessment; use conditionals ("if X is the intended claim, this resembles Y")

**3. Weaponization Mode**
- *Detection*: Output reads like ammunition for winning rather than understanding
- *Fix*: Always provide "Stronger Alternative" suggestions; acknowledge legitimate concerns behind flawed reasoning. In interpersonal contexts, prioritize clarity and communication over rhetorical victory

**4. False Negative Bias**
- *Detection*: Reluctant to call obvious fallacies because the conclusion seems reasonable
- *Fix*: Good conclusions can still rest on fallacious reasoning. Separate truth from validity

**5. Formal Fallacy Tunnel Vision**
- *Detection*: Forcing everyday arguments into strict syllogistic forms
- *Fix*: Reserve formal fallacy analysis for arguments actually presented in deductive form. Most real arguments are informal

## Worked Examples

### Example 1: Relationship Conflict

*Argument*: "You always ignore me when you're on your phone. Sarah's husband never uses his phone during dinner. You clearly don't care about our relationship like he does."

*Decision tree trace*: Argument exists → support partially connects → informal → terms consistent → hidden assumptions (phone use = not caring) → check presumption + relevance

**Fallacy 1**: Hasty Generalization (Presumption)
- **Explanation**: "You always ignore me" overgeneralizes from limited incidents to an absolute pattern
- **Severity**: Moderate
- **Stronger Alternative**: "When you're on your phone at dinner, I feel like I'm not a priority"

**Fallacy 2**: Faulty Analogy (Relevance)
- **Explanation**: Comparison to Sarah's husband ignores different couples, contexts, and relationship dynamics
- **Severity**: Moderate
- **Stronger Alternative**: "I'd like us to agree on some phone-free time together"

**Fallacy 3**: False Cause (Presumption)
- **Explanation**: Assumes phone use directly indicates lack of care — an unwarranted causal leap from behavior to intent
- **Severity**: Critical
- **Stronger Alternative**: "I worry you're not as engaged in our relationship as I'd like"

**Overall Assessment**: The core concern (wanting more attention) is legitimate, but the argument's reasoning structure undermines it. A direct expression of need is both more honest and more persuasive. *Expert vs novice note*: a novice focuses only on "you always"; an expert catches the layered presumption issues and sees the legitimate need beneath the flawed expression.

---

### Example 2: Policy Argument

*Argument*: "Dr. Hansen says we need carbon taxes. Either we implement them now or we're doomed to climate catastrophe. Anyone who opposes carbon taxes is clearly in denial about science."

**Fallacy 1**: Appeal to Authority (Relevance)
- **Explanation**: Single expert cited without corroborating evidence; authority alone is insufficient for contested policy claims
- **Severity**: Moderate
- **Stronger Alternative**: "Scientific consensus, including work by Hansen and others, supports carbon pricing as one effective climate intervention"

**Fallacy 2**: False Dilemma (Presumption)
- **Explanation**: "Carbon taxes or catastrophe" excludes many alternative climate policies that also address emissions
- **Severity**: Critical
- **Stronger Alternative**: "Carbon taxes are among the most evidence-backed climate interventions — here's why they're preferable to the alternatives"

**Fallacy 3**: Ad Hominem (Relevance)
- **Explanation**: Dismisses opponents as "in denial" rather than engaging their actual objections
- **Severity**: Moderate
- **Stronger Alternative**: "Objections to carbon taxes often focus on X — here's why those concerns don't outweigh the evidence"

**Overall Assessment**: Legitimate core (climate action needed) but reasoning undercuts persuasive force with anyone not already convinced. The argument survives the fallacies only if rebuilt with evidence and engagement with opposing views.

---

### Example 3: Hasty Generalization

*Argument*: "I've asked three people in my office and none of them like the new expense system. Clearly, the rollout has been a disaster and nobody is happy with it."

**Fallacy**: Hasty Generalization (Presumption)
- **Explanation**: Three colleagues in one office are not a representative sample. "Nobody is happy" wildly overstates what the evidence supports.
- **Severity**: Moderate
- **Stronger Alternative**: "Several colleagues I've spoken with are frustrated with the new system — worth gathering broader feedback before drawing conclusions about the overall rollout."

**Overall Assessment**: The underlying concern may be legitimate. Gathering more data would allow a defensible, actionable claim.

## Collaboration Hooks

- **Consumes from `toulmin-argument-analysis`**: If argument is already decomposed into Toulmin structure, use it as Step 1 input; the warrant is the highest-risk site for fallacies
- **Sends to `steel-man-argument`**: Pass repair suggestions and surviving elements to construct the most charitable non-fallacious version of the original position
- **Invoked by `discourse-coordinator`**: Provides fallacy analysis as part of broader discourse health assessment

## Reference Files

- `diagrams/01_flowchart_decision-points.md` — Mermaid flowchart routing incoming requests through scope check, constraint assessment, and pattern selection. **Read when** deciding which analysis path (plan, migrate, debug) fits the user's fallacy question.

- `references/taxonomy/formal-fallacies.md` — Detailed reference on deductive argument errors (affirming consequent, denying antecedent, undistributed middle, illicit major/minor). **Read when** the argument has explicit logical structure or uses conditional/syllogistic reasoning.

- `references/taxonomy/informal-fallacies.md` — Comprehensive guide to relevance, presumption, and ambiguity fallacies with real examples. **Read when** analyzing everyday arguments, debates, or discourse where content and framing matter more than formal structure.

- `references/examples/relationship-arguments.md` — Real-world fallacy examples from couple and interpersonal conflicts with non-fallacious restatements. **Read when** analyzing arguments in relationship or personal conflict contexts.

## Quality Gates

Analysis complete when:
- [ ] Core claim and support premises clearly identified
- [ ] Decision tree systematically applied to determine fallacy categories
- [ ] Each named fallacy includes specific textual evidence from the argument
- [ ] Severity assessment (Critical/Moderate/Minor) provided with rationale
- [ ] "Stronger Alternative" suggested for each fallacy that doesn't abandon the underlying concern
- [ ] Overall assessment addresses whether argument survives after fallacy removal
- [ ] Output distinguishes "wrong conclusion" from "fallacious reasoning"
- [ ] Context factors (relationship dynamics, implied premises) acknowledged when relevant
- [ ] Conservative labeling applied — only clear pattern matches get formal fallacy names
- [ ] Recommendations focus on clarity and understanding, not winning arguments

## Not-For Boundaries

**Do NOT use this skill for:**
- **Fact-checking claims** → Use `fact-verification` for empirical accuracy
- **Evaluating evidence quality** → Use `evidence-assessment` for source credibility and data strength
- **Building counter-arguments** → Use `steel-man-argument` for constructive responses
- **Analyzing argument structure** → Use `toulmin-argument-analysis` for mapping claims, grounds, and warrants
- **Relationship counseling** → Use `conflict-resolution` for interpersonal communication strategies
- **Detecting manipulation patterns** → Use `discourse-coordinator` for broader rhetorical analysis

**Boundary cases:**
- Arguments where conclusion is factually wrong but reasoning is valid → note the distinction, focus on logical structure only
- Emotional expressions not meant as logical arguments → acknowledge the difference between venting and reasoning
- Cultural or contextual communication styles that appear fallacious → note cultural factors affecting interpretation before labeling

---

`★ Insight ─────────────────────────────────────`
Key merge decisions: (1) The SCS Guardrails section was fully absorbed into the WORKGROUP Failure Modes — Failure Modes are more actionable (detection rule + fix) than raw guidelines, and the unique guardrail content ("describe weakness rather than force a name") was folded into Failure Mode 1. (2) Both examples sets were merged: WORKGROUP's relationship example now carries a decision-tree trace header showing the L3 procedural reasoning, while SCS's structured output format template is used throughout. (3) Collaboration Hooks are SCS-unique — they wire this skill into a broader multi-skill ecosystem (`toulmin-argument-analysis` → `logical-fallacy-detector` → `steel-man-argument`), which is architecturally valuable even though WORKGROUP's Not-For section hints at the same relationships.
`─────────────────────────────────────────────────`
