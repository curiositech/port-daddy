import { frameBody, isValidShipHandle } from '../lib/post-as.js'
test('probe import works', () => {
  expect(isValidShipHandle('reviewer')).toBe(true)
  const ship = { handle: 'reviewer', role: 'r', mark: '◆' }
  const out = frameBody(ship, 'hello')
  expect(out).toContain('**[pd-reviewer]**')
})
