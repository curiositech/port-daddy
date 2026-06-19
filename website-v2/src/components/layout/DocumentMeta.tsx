import { useLocation } from 'react-router-dom'
import { getRouteMetadata } from '@/data/siteMetadata'
import { useDocumentMeta } from '@/lib/useDocumentMeta'

export function DocumentMeta() {
  const location = useLocation()
  const route = getRouteMetadata(location.pathname)

  useDocumentMeta(route)

  return null
}
