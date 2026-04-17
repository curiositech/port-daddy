// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { WorkflowsTable } from './WorkflowsTable'
import { vi, describe, it, expect } from 'vitest'

vi.mock('@/hooks/useOrchestratorRules', () => ({
  useOrchestratorRules: () => ({ rules: [], loading: false, error: null, errorKind: null })
}))

describe('WorkflowsTable', () => {
  it('renders the table header', () => {
    render(<WorkflowsTable />)
    expect(screen.getByRole('heading', { name: /Reactive Pipelines/i })).toBeDefined()
  })
})
