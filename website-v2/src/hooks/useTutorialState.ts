import { useState, useEffect } from 'react'

export function useTutorialState(tutorialNumber: number) {
  const [hasReturned, setHasReturned] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('pd-last-tutorial')

    if (stored && parseInt(stored) === tutorialNumber) {
      const lastVisit = localStorage.getItem('pd-last-visit')
      if (lastVisit) {
        const hoursSince = (Date.now() - parseInt(lastVisit)) / (1000 * 60 * 60)
        if (hoursSince > 0.5) { // Show reorientation if away for >30 min
          setHasReturned(true)
        }
      }
    }

    // Save current position
    localStorage.setItem('pd-last-tutorial', tutorialNumber.toString())
    localStorage.setItem('pd-last-visit', Date.now().toString())
  }, [tutorialNumber])

  const dismissReturn = () => setHasReturned(false)

  const markVisit = () => {
    localStorage.setItem('pd-last-tutorial', tutorialNumber.toString())
    localStorage.setItem('pd-last-visit', Date.now().toString())
  }

  return { hasReturned, dismissReturn, markVisit }
}
