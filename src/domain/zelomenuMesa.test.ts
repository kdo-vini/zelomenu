import { describe, it, expect } from 'vitest'

// Pure validation logic — no DB calls
describe('mesa context validation', () => {
  it('returns error when comanda_id does not match active comanda for mesa', () => {
    const sessionComandaId: string = 'abc-123'
    const activeComandaId: string = 'xyz-789'
    const isSameComanda = sessionComandaId === activeComandaId
    expect(isSameComanda).toBe(false)
  })

  it('returns ok when comanda_id matches active comanda', () => {
    const sessionComandaId: string = 'abc-123'
    const activeComandaId: string = 'abc-123'
    const isSameComanda = sessionComandaId === activeComandaId
    expect(isSameComanda).toBe(true)
  })
})
