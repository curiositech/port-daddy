import { Outlet } from 'react-router-dom'
import { SiteHeader } from '@/components/site/SiteHeader'

export function MainLayout() {
  return (
    <>
      <SiteHeader />
      <Outlet />
    </>
  )
}
