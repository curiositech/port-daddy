import { Outlet } from 'react-router-dom'
import { Nav } from '@/components/landing/Nav'

export function MainLayout() {
  return (
    <>
      <Nav />
      <Outlet />
    </>
  )
}
