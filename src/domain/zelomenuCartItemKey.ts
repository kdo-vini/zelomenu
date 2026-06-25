import type { ZeloMenuModifierSelectionInput } from './zelomenuModifiers';

export function buildModifierSignature(
  selectedOptions: ZeloMenuModifierSelectionInput[] | null | undefined,
): string {
  if (!selectedOptions || selectedOptions.length === 0) return 'plain';
  return (
    selectedOptions
      .map((g) => `${g.groupId}:${[...g.optionIds].sort().join(',')}`)
      .sort()
      .join('|') || 'plain'
  );
}

export function buildCartItemKey(
  productId: string | number,
  selectedOptions: ZeloMenuModifierSelectionInput[] | null | undefined,
): string {
  return `${productId}::${buildModifierSignature(selectedOptions)}`;
}
