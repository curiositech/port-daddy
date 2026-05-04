// Auto-loaded dialogue artifacts for the adversarial-review changelog.
// Each round emits a JSON file at docs/shipwright/dialogue-v(N)-to-v(N+1).json;
// the file is symlinked or copied here as a ?raw import so the website builds
// it into the bundle.

import dialogueV20to21 from '../../../docs/shipwright/dialogue-v2.0-to-v2.1.json'
import dialogueV21to22 from '../../../docs/shipwright/dialogue-v2.1-to-v2.2.json'
import dialogueV22to23 from '../../../docs/shipwright/dialogue-v2.2-to-v2.3.json'
import dialogueV23to24 from '../../../docs/shipwright/dialogue-v2.3-to-v2.4.json'
import dialogueV24to25 from '../../../docs/shipwright/dialogue-v2.4-to-v2.5.json'

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
