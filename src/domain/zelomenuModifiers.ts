export type ZeloMenuModifierGroupKind = 'adicional' | 'variacao';

export type ZeloMenuLinkedModifierProduct = {
  productId: number;
  name: string;
  photoUrl: string | null;
  price: number;
  available: boolean;
};

export type ZeloMenuModifierOption = {
  id: string;
  name: string;
  priceDelta: number;
  active: boolean;
  order: number;
  linkedProduct?: ZeloMenuLinkedModifierProduct | null;
};

export type ZeloMenuModifierGroup = {
  id: string;
  productId: number;
  name: string;
  kind: ZeloMenuModifierGroupKind;
  pricingMode: 'somar' | 'substituir';
  minSelections: number;
  maxSelections: number | null;
  allowsQuantity: boolean;
  maxPerOption: number | null;
  active: boolean;
  order: number;
  options: ZeloMenuModifierOption[];
};

export type ZeloMenuModifierOptionDraft = {
  id?: string;
  name: string;
  priceDelta: number;
  active: boolean;
  order: number;
  linkedProductId?: number | null;
  priceOverride?: number | null;
};

export type ZeloMenuModifierGroupDraft = {
  id?: string;
  name: string;
  kind: ZeloMenuModifierGroupKind;
  pricingMode: 'somar' | 'substituir';
  minSelections: number;
  maxSelections: number | null;
  allowsQuantity: boolean;
  maxPerOption: number | null;
  active: boolean;
  order: number;
  options: ZeloMenuModifierOptionDraft[];
};

export type ZeloMenuModifierSelectionInput = {
  groupId: string;
  optionSelections: Array<{ optionId: string; quantity: number }>;
};

export type ZeloMenuSelectedModifierOption = {
  optionId: string;
  optionName: string;
  priceDelta: number;
  quantity: number;
};

export type ZeloMenuSelectedModifierGroup = {
  groupId: string;
  groupName: string;
  kind: ZeloMenuModifierGroupKind;
  selectedOptions: ZeloMenuSelectedModifierOption[];
};

export type ZeloMenuModifierResolutionErrorCode =
  | 'group_missing'
  | 'option_missing'
  | 'group_required'
  | 'selection_bounds'
  | 'option_quantity_exceeded';

export type ZeloMenuModifierResolutionResult =
  | {
      ok: true;
      selectedGroups: ZeloMenuSelectedModifierGroup[];
      deltaTotal: number;
      finalUnitPrice: number;
    }
  | {
      ok: false;
      code: ZeloMenuModifierResolutionErrorCode;
      message: string;
    };

export type ModifierAwareCartItem = {
  productName: string;
  selectedModifiers?: ZeloMenuSelectedModifierGroup[] | null;
};

export type ZeloMenuModifierOptionProductLink = {
  optionId: string;
  productId: number;
  priceOverride: number | null;
};

export function sortModifierGroups(groups: ZeloMenuModifierGroup[]): ZeloMenuModifierGroup[] {
  return [...groups]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((group) => ({
      ...group,
      options: [...group.options].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    }));
}

export { buildModifierSignature as buildModifierSelectionKey } from './zelomenuCartItemKey';

function resolveOptionPrice(
  option: ZeloMenuModifierOption,
): number {
  if (option.linkedProduct) {
    return option.linkedProduct.price;
  }
  return roundCurrency(option.priceDelta);
}

export function resolveModifierSelections(
  groups: ZeloMenuModifierGroup[] | null | undefined,
  selections: ZeloMenuModifierSelectionInput[] | null | undefined,
  basePrice: number,
): ZeloMenuModifierResolutionResult {
  const activeGroups = sortModifierGroups((groups ?? []).filter((group) => group.active));
  if (activeGroups.length === 0) {
    return { ok: true, selectedGroups: [], deltaTotal: 0, finalUnitPrice: roundCurrency(basePrice) };
  }

  // Validate all groups exist first
  for (const selection of selections ?? []) {
    const knownGroup = activeGroups.find((group) => group.id === selection.groupId);
    if (!knownGroup) {
      return {
        ok: false,
        code: 'group_missing',
        message: 'Um grupo de adicionais desse item não está mais disponível.',
      };
    }
  }

  const selectedGroups: ZeloMenuSelectedModifierGroup[] = [];
  let baseOverride: number | null = null;
  let addDeltaTotal = 0;

  for (const group of activeGroups) {
    const input = (selections ?? []).find((s) => s.groupId === group.id);
    const rawSelections = input?.optionSelections ?? [];
    const activeOptions = group.options.filter((option) => option.active && option.linkedProduct?.available !== false);
    const selectedOptions: ZeloMenuSelectedModifierOption[] = [];

    // Defensive sanitization: quantity must be positive integer
    const sanitized: Array<{ optionId: string; quantity: number }> = [];
    for (const sel of rawSelections) {
      if (typeof sel.optionId !== 'string' || !sel.optionId.trim()) continue;
      const qty = Math.floor(Number(sel.quantity));
      if (!Number.isFinite(qty) || qty < 1) continue; // 0 = deselected, NaN/negative = invalid
      sanitized.push({ optionId: sel.optionId.trim(), quantity: qty });
    }

    for (const sel of sanitized) {
      const option = activeOptions.find((candidate) => candidate.id === sel.optionId);
      if (!option) {
        return {
          ok: false,
          code: 'option_missing',
          message: `Uma opção de ${group.name} não está mais disponível.`,
        };
      }

      // Validate maxPerOption
      if (group.allowsQuantity && group.maxPerOption != null && sel.quantity > group.maxPerOption) {
        return {
          ok: false,
          code: 'option_quantity_exceeded',
          message: `Você pode escolher no máximo ${selectionCountLabel(group.maxPerOption)} de ${option.name}.`,
        };
      }

      selectedOptions.push({
        optionId: option.id,
        optionName: option.linkedProduct ? option.linkedProduct.name : option.name,
        priceDelta: resolveOptionPrice(option),
        quantity: sel.quantity,
      });
    }

    if (selectedOptions.length < group.minSelections) {
      return {
        ok: false,
        code: 'group_required',
        message: `Escolha ${selectionCountLabel(group.minSelections)} em ${group.name}.`,
      };
    }

    if (group.maxSelections != null && selectedOptions.length > group.maxSelections) {
      return {
        ok: false,
        code: 'selection_bounds',
        message: `Você pode escolher no máximo ${selectionCountLabel(group.maxSelections)} em ${group.name}.`,
      };
    }

    if (selectedOptions.length > 0) {
      if (group.pricingMode === 'substituir') {
        // Grupo de substituição é sempre escolha única (validado em
        // validateModifierGroupDrafts) e não combina com allowsQuantity
        // (que exige maxSelections !== 1) — sempre 1 opção, quantity 1.
        baseOverride = selectedOptions[0].priceDelta;
      } else {
        for (const option of selectedOptions) {
          addDeltaTotal += option.priceDelta * option.quantity;
        }
      }

      selectedGroups.push({
        groupId: group.id,
        groupName: group.name,
        kind: group.kind,
        selectedOptions,
      });
    }
  }

  const finalUnitPrice = roundCurrency((baseOverride ?? basePrice) + addDeltaTotal);

  return {
    ok: true,
    selectedGroups,
    deltaTotal: roundCurrency(finalUnitPrice - basePrice),
    finalUnitPrice,
  };
}

export function formatSelectedModifierGroups(
  selectedGroups: ZeloMenuSelectedModifierGroup[] | null | undefined,
): string {
  if (!selectedGroups || selectedGroups.length === 0) return '';
  return selectedGroups
    .map((group) => {
      const options = group.selectedOptions
        .map((option) => option.quantity > 1 ? `${option.quantity}x ${option.optionName}` : option.optionName)
        .join(', ');
      return `${group.groupName}: ${options}`;
    })
    .join(' • ');
}

export function formatModifierAwareCartItem(item: ModifierAwareCartItem): string {
  const summary = formatSelectedModifierGroups(item.selectedModifiers);
  return summary ? `${item.productName} (${summary})` : item.productName;
}

export function validateModifierGroupDrafts(groups: ZeloMenuModifierGroupDraft[]): string | null {
  let substitutionCount = 0;

  for (const group of groups) {
    if (!group.name.trim()) return 'Todo grupo precisa de um nome.';
    if (group.minSelections < 0) return `O grupo ${group.name} tem mínimo inválido.`;
    if (group.maxSelections != null && group.maxSelections < Math.max(group.minSelections, 1)) {
      return `O grupo ${group.name} precisa de um máximo maior ou igual ao mínimo.`;
    }
    if (group.allowsQuantity && group.maxSelections === 1) {
      return `Grupo de escolha única não pode permitir quantidade.`;
    }
    if (group.maxPerOption != null && group.maxPerOption < 1) {
      return `O grupo ${group.name} tem máximo por opção inválido.`;
    }
    if (group.allowsQuantity && group.kind === 'variacao') {
      return `Quantidade só é permitida em grupos do tipo Adicional.`;
    }
    if (group.options.length === 0) {
      return `O grupo ${group.name} precisa ter pelo menos uma opção.`;
    }

    if (group.pricingMode === 'substituir') {
      if (group.maxSelections !== 1) {
        return 'Grupo de substituição de preço precisa ser de escolha única (máximo = 1).';
      }
      substitutionCount += 1;
    }

    let activeOptions = 0;
    for (const option of group.options) {
      if (!option.name.trim() && !option.linkedProductId) {
        return `Uma opção do grupo ${group.name} está sem nome.`;
      }
      if (!Number.isFinite(option.priceDelta) || option.priceDelta < 0) {
        return `A opção ${option.name || 'sem nome'} do grupo ${group.name} tem preço adicional inválido.`;
      }
      if (option.active) activeOptions += 1;
    }

    if (group.active && activeOptions < group.minSelections) {
      return `O grupo ${group.name} precisa de pelo menos ${selectionCountLabel(group.minSelections)} ativa(s).`;
    }
  }

  if (substitutionCount > 1) {
    return 'Só pode existir um grupo de substituição de preço por produto.';
  }

  return null;
}

function selectionCountLabel(value: number): string {
  return `${value} ${value === 1 ? 'opção' : 'opções'}`;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
