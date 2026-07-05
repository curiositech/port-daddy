import { Outlet, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { SiteHeader } from '@/components/site/SiteHeader'
import { HeroWordmarkContext } from '@/lib/hero-brand-context'

export function MainLayout() {
  // On the home route the hero wordmark is on-screen at first paint, so start
  // the navbar wordmark hidden to avoid a flash of the duplicate on load. The
  // hero's IntersectionObserver keeps it accurate from there.
  const isHome = useLocation().pathname === '/'
  const [heroWordmarkVisible, setHeroWordmarkVisible] = useState(isHome)

  return (
    <HeroWordmarkContext.Provider
      value={{ heroWordmarkVisible, setHeroWordmarkVisible }}
    >
      <SiteHeader />
      <Outlet />
    </HeroWordmarkContext.Provider>
  )
}
