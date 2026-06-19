import * as React from 'react'

const STORAGE_KEY = 'pd-completed-tutorials'

function readCompletedTutorials(): number[] {
  if (typeof window === 'undefined') return []

  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (!stored) return []

  try {
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []

    return parsed.filter((value): value is number => Number.isInteger(value))
  } catch {
    return []
  }
}

export function useTutorialProgress() {
  const [completedTutorials, setCompletedTutorials] = React.useState<number[]>(readCompletedTutorials)

  const markComplete = React.useCallback((tutorialNumber: number) => {
    if (completedTutorials.includes(tutorialNumber)) return

    const updated = [...completedTutorials, tutorialNumber].sort((a, b) => a - b)
    setCompletedTutorials(updated)

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    }
  }, [completedTutorials])

  const isCompleted = React.useCallback(
    (tutorialNumber: number) => completedTutorials.includes(tutorialNumber),
    [completedTutorials],
  )

  return { completedTutorials, markComplete, isCompleted }
}
