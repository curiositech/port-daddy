import { useState, useEffect } from 'react'

function readHasReturned(tutorialNumber: number) {
  if (typeof window === 'undefined') return false

  const stored = window.localStorage.getItem('pd-last-tutorial')
  if (!stored || Number.parseInt(stored, 10) !== tutorialNumber) return false

  const lastVisit = window.localStorage.getItem('pd-last-visit')
  if (!lastVisit) return false

  const hoursSince = (Date.now() - Number.parseInt(lastVisit, 10)) / (1000 * 60 * 60)
  return hoursSince > 0.5
}

export function useTutorialState(tutorialNumber: number) {
  const [hasReturned, setHasReturned] = useState(() => readHasReturned(tutorialNumber))

  useEffect(() => {
    window.localStorage.setItem('pd-last-tutorial', tutorialNumber.toString())
    window.localStorage.setItem('pd-last-visit', Date.now().toString())
  }, [tutorialNumber])

  const dismissReturn = () => setHasReturned(false)

  const markVisit = () => {
    window.localStorage.setItem('pd-last-tutorial', tutorialNumber.toString())
    window.localStorage.setItem('pd-last-visit', Date.now().toString())
  }

  return { hasReturned, dismissReturn, markVisit }
}
