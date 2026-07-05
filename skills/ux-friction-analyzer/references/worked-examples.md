# Worked Examples

Two full journey simulations showing the failure modes and decision points
from `SKILL.md` diagnosed and fixed step by step. Load this when you need a
template for how to structure a friction audit narrative, not just the list
of failure modes.

## Example 1: E-commerce Checkout for ADHD User

**Scenario**: User with ADHD purchasing laptop accessories, gets distracted mid-checkout

**Current Flow Analysis**:
```
0:00  User adds items to cart (3 items)
      └─ Cart shows: Item list, recommendations, promo codes, shipping calculator

0:30  Clicks "Checkout" → Redirected to shipping form
      └─ Form has 12 fields, required fields marked with *

1:45  Phone notification interrupts
      └─ User checks notification, returns to checkout

2:30  User confused - form partially filled but unclear what's complete
      └─ Starts over, re-enters shipping address

4:00  Gets to payment step → Credit card form asks for billing address
      └─ User forgot if billing = shipping, sees no indication

6:15  Completes payment → "Processing..." with spinning wheel
      └─ No time estimate, user worries something broke

7:30  Success page → Generic "Order complete" message
      └─ User unsure what happens next, when items ship
```

**Decision Points Hit**:
- **Distracted/Multitasking** + **Time-pressured** → Should use auto-save + progress preservation
- **High Extraneous Load** (too many form fields) → Should chunk into steps
- **Context Switch** event → Need re-orientation support

**Optimized Flow**:
```
0:00  User adds items to cart
      └─ Cart shows: Item list only, single "Secure Checkout" button (44px tall)

0:15  Checkout → Single step: "Where should we ship this?"
      └─ Address form only, with "Use my saved address" option
      └─ Auto-save on every keystroke

1:30  Phone interrupts → User leaves page

2:00  User returns → Banner: "Continue your checkout - we saved your progress"
      └─ Address pre-filled, "Next: Payment" button ready

2:15  Payment step → "Same billing address?" with Yes (default) / No toggle
      └─ Credit card form with visual validation (green checkmarks)

3:00  Submit → "Processing payment..." with progress bar
      └─ "This usually takes 10-15 seconds"

3:15  Success → "Order #12345 confirmed! Ships Tuesday, arrives Friday"
      └─ "Track your order" button + calendar reminder option
```

**Key Changes**:
- Reduced 12 form fields to 3 focused steps
- Added auto-save and progress restoration
- Provided time estimates for all wait states
- Used recognition over recall for billing address

## Example 2: Software Dashboard Friction Audit

**Scenario**: SaaS analytics dashboard used by marketing teams

**Journey Simulation**:
```
User Intent: Create weekly report for executive team
Cognitive State: Time-pressured (due in 30 minutes)
Experience Level: Intermediate (uses tool monthly)

FRICTION AUDIT:
0:00  Lands on dashboard → 47 different widgets/charts visible
      FRICTION: Overwhelm Cascade - too many data points
      COGNITIVE LOAD: High extraneous

0:45  Looking for "Create Report" function → Finds it in hamburger menu
      FRICTION: Hidden primary action
      TIME LOSS: 45 seconds of hunting

1:30  Report builder opens → 23 chart type options in dropdown
      FRICTION: Too many choices for time-pressured user
      DECISION NEEDED: Past reports were always bar charts + line graphs

3:00  Selects data sources → Interface shows all 47 available sources
      FRICTION: No smart filtering based on user's team/role
      TIME LOSS: 90 seconds scrolling through irrelevant options

5:30  Starts building first chart → No template from last week's report
      FRICTION: No learning from user patterns
      CONTEXT SWITCH RISK: User might leave to find last week's report

8:00  Chart renders slowly (12 seconds) → No progress indication
      FRICTION: Invisible Progress Paralysis
      USER ANXIETY: "Is it broken? Should I refresh?"

15:00 Report preview → Executive template not applied automatically
       FRICTION: Micro-friction accumulation
       EXPERT USER ISSUE: No keyboard shortcuts for power users
```

**Optimization Decisions**:
- **Overwhelmed + Time-pressured** → Use smart defaults + recent templates
- **High Extraneous Load** → Filter options by user role/past behavior
- **Expert User** + **Familiar task** → Provide power-user shortcuts
