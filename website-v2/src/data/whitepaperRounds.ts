// Auto-loaded dialogue artifacts for the adversarial-review changelog.
// Historical round records live with the rest of the corpus review archive;
// direct imports let the website bundle them without creating another copy.

import dialogueV20to21 from '../../../whitepaper/reviews/archive/shipwright/dialogue-v2.0-to-v2.1.json'
import dialogueV21to22 from '../../../whitepaper/reviews/archive/shipwright/dialogue-v2.1-to-v2.2.json'
import dialogueV22to23 from '../../../whitepaper/reviews/archive/shipwright/dialogue-v2.2-to-v2.3.json'
import dialogueV23to24 from '../../../whitepaper/reviews/archive/shipwright/dialogue-v2.3-to-v2.4.json'
import dialogueV24to25 from '../../../whitepaper/reviews/archive/shipwright/dialogue-v2.4-to-v2.5.json'

export interface RoundExchange {
  id: string
  class: string
  section: string
  severity: 'high' | 'medium' | 'low' | 'scope-clarification'
  title: string
  smell_from: string
  fix_from: string
  fix_status:
    | 'staged'
    | 'partial'
    | 'landed-in-paper'
    | 'scope-clarified'
    | 'scope-narrowed'
    | 'declined'
  artifact?: string
}

export interface RoundCarried {
  id: string
  class: string
  title: string
  reason: string
}

export interface RoundDialogue {
  round_from: string
  round_to: string
  kind?: 'bootstrap' | 'normal'
  sealed_at: string
  lead: string
  exchanges: RoundExchange[]
  carried: RoundCarried[]
  paper_changes_v21?: string[]
  paper_changes?: string[]
  infrastructure_added_v21?: string[]
  reputation_deltas?: Record<string, string>
}

// Most-recent first.
export const ROUNDS: RoundDialogue[] = [
  dialogueV24to25 as unknown as RoundDialogue,
  dialogueV23to24 as unknown as RoundDialogue,
  dialogueV22to23 as unknown as RoundDialogue,
  dialogueV21to22 as unknown as RoundDialogue,
  dialogueV20to21 as unknown as RoundDialogue,
]
