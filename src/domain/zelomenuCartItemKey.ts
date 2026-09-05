import { buildPizzaSignature } from './pizza.js';
import type { PizzaSelection } from './pizzaTypes';
import type { ZeloMenuModifierSelectionInput } from './zelomenuModifiers';

export function buildModifierSignature(
  selectedOptions: ZeloMenuModifierSelectionInput[] | null | undefined,
): string {
  if (!selectedOptions || selectedOptions.length === 0) return 'plain';
  return (
    selectedOptions
      .map((g) => {
        const sorted = [...g.optionSelections]
          .sort((a, b) => a.optionId.localeCompare(b.optionId));
        return `${g.groupId}:${sorted.map((s) => `${s.optionId}:${s.quantity}`).join(',')}`;
      })
      .sort()
      .join('|') || 'plain'
  );
}

export function buildCartItemKey(
  productId: string | number,
  selectedOptions: ZeloMenuModifierSelectionInput[] | null | undefined,
  notes?: string | null,
  pizzaSelection?: PizzaSelection,
): string {
  const normalizedNotes = notes?.trim() ?? '';
  return `${productId}::${buildModifierSignature(selectedOptions)}${pizzaSelection ? `::pizza:${buildPizzaSignature(pizzaSelection)}` : ''}${normalizedNotes ? `::note:${normalizedNotes}` : ''}`;
}
