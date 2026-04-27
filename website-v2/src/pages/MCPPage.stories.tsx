import type { Meta, StoryObj } from '@storybook/react'
import { MemoryRouter } from 'react-router-dom'
import McpPage from './MCPPage'

const meta = {
  title: 'Pages/MCP Proof Route',
  component: McpPage,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    a11y: {
      test: 'error',
    },
  },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof McpPage>

export default meta
type Story = StoryObj<typeof meta>

export const FullRoute: Story = {}

export const MobileAuditFrame: Story = {
  render: () => (
    <div className="mx-auto min-h-screen w-full max-w-[390px] overflow-hidden border-x-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
      <McpPage />
    </div>
  ),
}
