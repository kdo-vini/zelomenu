import { describe, expect, it } from 'vitest';
import { buildZeloMenuAutosaveSignature } from './zeloMenuAutosave';

describe('zelo menu autosave signature', () => {
  it('does not schedule another save when only the server revision changes', () => {
    const first = { expectedRevision: 4, customerName: 'Ana', items: [{ productId: 1, quantity: 2 }] };
    const next = { ...first, expectedRevision: 5 };
    expect(buildZeloMenuAutosaveSignature(first)).toBe(buildZeloMenuAutosaveSignature(next));
  });

  it('changes when the draft content changes', () => {
    const first = { expectedRevision: 4, customerName: 'Ana' };
    const next = { expectedRevision: 4, customerName: 'Bia' };
    expect(buildZeloMenuAutosaveSignature(first)).not.toBe(buildZeloMenuAutosaveSignature(next));
  });
});
