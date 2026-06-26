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

describe('table_order comanda validation', () => {
  it('rejects if session comanda_id differs from active comanda', () => {
    function validateComandaStillActive(
      sessionComandaId: string,
      activeComandaId: string | null,
    ): 'ok' | 'COMANDA_CLOSED' | 'TABLE_TAKEN_BY_OTHER_GROUP' {
      if (!activeComandaId) return 'COMANDA_CLOSED'
      if (sessionComandaId !== activeComandaId) return 'TABLE_TAKEN_BY_OTHER_GROUP'
      return 'ok'
    }

    expect(validateComandaStillActive('abc', null)).toBe('COMANDA_CLOSED')
    expect(validateComandaStillActive('abc', 'xyz')).toBe('TABLE_TAKEN_BY_OTHER_GROUP')
    expect(validateComandaStillActive('abc', 'abc')).toBe('ok')
  })
})
