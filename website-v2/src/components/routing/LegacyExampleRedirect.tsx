import { Navigate, useParams } from 'react-router-dom'

export function LegacyExampleRedirect() {
  const { id } = useParams<{ id?: string }>()
  return <Navigate to={id ? `/examples/${id}` : '/examples'} replace />
}
