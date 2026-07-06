import * as React from 'react'

/**
 * Shared signal so the sticky navbar and the hero can agree about the brand.
 *
 * `heroWordmarkVisible` is true while the hero's wordmark lockup is on-screen.
 * The navbar hides its own wordmark then — two "Port Daddy" lockups stacked at
 * once is duplicative — and fades it back in once you scroll past the hero.
 * Defaults to false, so any page without a hero (which never sets it) always
 * shows the navbar wordmark.
 */
export const HeroWordmarkContext = React.createContext<{
  heroWordmarkVisible: boolean
  setHeroWordmarkVisible: (visible: boolean) => void
}>({
  heroWordmarkVisible: false,
  setHeroWordmarkVisible: () => {},
})

export function useHeroWordmark() {
  return React.useContext(HeroWordmarkContext)
}
