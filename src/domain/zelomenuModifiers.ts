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
  minTotalQuantity: number;
  maxTotalQuantity: number | null;
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
  minTotalQuantity: number;
  maxTotalQuantity: number | null;
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
  | 'group_quantity_required'
  | 'group_quantity_exceeded'
  | 'selection_bounds'
  | 'option_quantity_exceeded'
  | 'option_quantity_invalid';

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

export function setModifierOptionActive<T extends ZeloMenuModifierGroup>(
  groups: T[],
  optionId: string,
  active: boolean,
): T[] {
  return groups.map((group) => {
    const options = group.options.map((option) => (
      option.id === optionId ? { ...option, active } : option
    ));

    return options.some((option, index) => option !== group.options[index])
      ? { ...group, options } as T
      : group;
  });
}

export { buildModifierSignature as buildModifierSelectionKey } from './zelomenuCartItemKey';

export function resolveModifierOptionPrice(
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
    const rawSelections = (selections ?? [])
      .filter((selection) => selection.groupId === group.id)
      .flatMap((selection) => selection.optionSelections ?? []);
    const activeOptions = group.options.filter((option) => option.active && option.linkedProduct?.available !== false);
    const selectedOptions: ZeloMenuSelectedModifierOption[] = [];

    // Quantidades chegam ao servidor pelo payload do carrinho. Não arredonde,
    // converta ou descarte valores inválidos: isso poderia alterar o preço ou
    // permitir que um payload adulterado escapasse dos limites do grupo.
    const quantitiesByOption = new Map<string, number>();
    for (const sel of rawSelections) {
      if (typeof sel.optionId !== 'string' || !sel.optionId.trim()) continue;
      const quantity = sel.quantity;
      if (!Number.isSafeInteger(quantity) || quantity < 1 || (!group.allowsQuantity && quantity !== 1)) {
        return {
          ok: false,
          code: 'option_quantity_invalid',
          message: `A quantidade escolhida para uma opção de ${group.name} é inválida.`,
        };
      }
      const optionId = sel.optionId.trim();
      const currentQuantity = quantitiesByOption.get(optionId) ?? 0;
      const nextQuantity = currentQuantity + quantity;
      if (!Number.isSafeInteger(nextQuantity)) {
        return {
          ok: false,
          code: 'option_quantity_invalid',
          message: `A quantidade escolhida para uma opção de ${group.name} é inválida.`,
        };
      }
      quantitiesByOption.set(optionId, nextQuantity);
    }

    for (const [optionId, quantity] of quantitiesByOption) {
      const option = activeOptions.find((candidate) => candidate.id === optionId);
      if (!option) {
        return {
          ok: false,
          code: 'option_missing',
          message: `Uma opção de ${group.name} não está mais disponível.`,
        };
      }

      // Validate maxPerOption
      if (group.allowsQuantity && group.maxPerOption != null && quantity > group.maxPerOption) {
        return {
          ok: false,
          code: 'option_quantity_exceeded',
          message: `Você pode escolher no máximo ${selectionCountLabel(group.maxPerOption)} de ${option.name}.`,
        };
      }

      selectedOptions.push({
        optionId: option.id,
        optionName: option.linkedProduct ? option.linkedProduct.name : option.name,
        priceDelta: resolveModifierOptionPrice(option),
        quantity,
      });
    }

    const totalQuantity = selectedOptions.reduce((total, option) => total + option.quantity, 0);
    if (!Number.isSafeInteger(totalQuantity)) {
      return {
        ok: false,
        code: 'option_quantity_invalid',
        message: `A quantidade escolhida para ${group.name} é inválida.`,
      };
    }
    const minTotalQuantity = group.allowsQuantity ? Math.max(0, group.minTotalQuantity ?? 0) : 0;
    const maxTotalQuantity = group.allowsQuantity ? group.maxTotalQuantity ?? null : null;

    if (totalQuantity < minTotalQuantity) {
      return {
        ok: false,
        code: 'group_quantity_required',
        message: `Escolha ${quantityCountLabel(minTotalQuantity)} no total em ${group.name}.`,
      };
    }

    if (maxTotalQuantity != null && totalQuantity > maxTotalQuantity) {
      return {
        ok: false,
        code: 'group_quantity_exceeded',
        message: `Você pode escolher no máximo ${quantityCountLabel(maxTotalQuantity)} no total em ${group.name}.`,
      };
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

export function previewModifierPrice(
  groups: ZeloMenuModifierGroup[] | null | undefined,
  selections: ZeloMenuModifierSelectionInput[] | null | undefined,
  basePrice: number,
): {
  unitPrice: number;
  hasRequiredGroup: boolean;
  hasSelectedRequiredOption: boolean;
} {
  const activeGroups = sortModifierGroups((groups ?? []).filter((group) => group.active));
  let baseOverride: number | null = null;
  let lowestSubstitutionPrice: number | null = null;
  let additionsTotal = 0;
  let requiredAdditionsMinimum = 0;
  let hasRequiredGroup = false;
  let requiredGroupsCount = 0;
  let allRequiredGroupsSatisfied = true;

  for (const group of activeGroups) {
    const activeOptions = group.options.filter((option) => option.active && option.linkedProduct?.available !== false);
    const rawSelections = (selections ?? [])
      .filter((selection) => selection.groupId === group.id)
      .flatMap((selection) => selection.optionSelections ?? []);
    const quantitiesByOption = new Map<string, number>();
    for (const selection of rawSelections) {
      if (typeof selection.optionId !== 'string' || !selection.optionId.trim()) continue;
      if (!Number.isSafeInteger(selection.quantity) || selection.quantity < 1) continue;
      const current = quantitiesByOption.get(selection.optionId.trim()) ?? 0;
      const next = current + selection.quantity;
      if (Number.isSafeInteger(next)) quantitiesByOption.set(selection.optionId.trim(), next);
    }
    const selectedOptions = [...quantitiesByOption.entries()]
      .map(([optionId, quantity]) => ({
        option: activeOptions.find((candidate) => candidate.id === optionId),
        quantity,
      }))
      .filter((selection) => selection.option);
    const validQuantitiesByOption = new Map(
      selectedOptions.map((selection) => [selection.option!.id, selection.quantity]),
    );
    const selectedQuantity = selectedOptions.reduce((total, selection) => total + selection.quantity, 0);
    const requiredDistinct = group.minSelections > 0;
    const requiredQuantity = group.allowsQuantity && (group.minTotalQuantity ?? 0) > 0;
    const hasRequired = requiredDistinct || requiredQuantity;
    if (hasRequired) {
      hasRequiredGroup = true;
      requiredGroupsCount += 1;
      const meetsDistinct = selectedOptions.length >= group.minSelections;
      const meetsQuantity = !requiredQuantity || selectedQuantity >= (group.minTotalQuantity ?? 0);
      if (!meetsDistinct || !meetsQuantity) allRequiredGroupsSatisfied = false;
    }

    if (group.pricingMode === 'substituir') {
      const selectedOption = selectedOptions[0]?.option;
      if (selectedOption) {
        baseOverride = resolveModifierOptionPrice(selectedOption);
      } else if (hasRequired) {
        const lowestPrice = activeOptions
          .map(resolveModifierOptionPrice)
          .sort((a, b) => a - b)[0];
        if (lowestPrice != null) lowestSubstitutionPrice = lowestPrice;
      }
      continue;
    }

    for (const selection of selectedOptions) {
      additionsTotal += resolveModifierOptionPrice(selection.option!) * selection.quantity;
    }
    if (hasRequired) {
      const missingPrice = minimumMissingQuantityPrice(group, activeOptions, validQuantitiesByOption);
      requiredAdditionsMinimum += missingPrice;
    }
  }

  const hasSelectedRequiredOption = requiredGroupsCount > 0 && allRequiredGroupsSatisfied;
  const selectedUnitPrice = (baseOverride ?? basePrice) + additionsTotal;
  const startingUnitPrice = (lowestSubstitutionPrice ?? baseOverride ?? basePrice)
    + (hasSelectedRequiredOption ? additionsTotal : requiredAdditionsMinimum + additionsTotal);

  return {
    unitPrice: roundCurrency(hasSelectedRequiredOption ? selectedUnitPrice : startingUnitPrice),
    hasRequiredGroup,
    hasSelectedRequiredOption,
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
    const minTotalQuantity = group.minTotalQuantity ?? 0;
    const maxTotalQuantity = group.maxTotalQuantity ?? null;
    if (!Number.isSafeInteger(minTotalQuantity) || minTotalQuantity < 0) {
      return `O grupo ${group.name} tem quantidade total mínima inválida.`;
    }
    if (maxTotalQuantity != null && (!Number.isSafeInteger(maxTotalQuantity) || maxTotalQuantity < minTotalQuantity)) {
      return `A quantidade total mínima do grupo ${group.name} não pode ser maior que a máxima.`;
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

function quantityCountLabel(value: number): string {
  return `${value} ${value === 1 ? 'item' : 'itens'}`;
}

function minimumMissingQuantityPrice(
  group: ZeloMenuModifierGroup,
  activeOptions: ZeloMenuModifierOption[],
  selectedQuantities: Map<string, number>,
): number {
  const requiredDistinct = Math.max(0, group.minSelections);
  const requiredTotal = group.allowsQuantity
    ? Math.max(requiredDistinct, group.minTotalQuantity ?? 0)
    : requiredDistinct;
  if (requiredTotal === 0) return 0;

  const options = [...activeOptions].sort((a, b) => resolveModifierOptionPrice(a) - resolveModifierOptionPrice(b) || a.order - b.order);
  const added = new Map<string, number>();
  let missingDistinct = Math.max(0, requiredDistinct - selectedQuantities.size);
  let missingTotal = Math.max(0, requiredTotal - [...selectedQuantities.values()].reduce((total, quantity) => total + quantity, 0));
  let total = 0;

  if (!group.allowsQuantity) {
    for (const option of options) {
      if (missingDistinct <= 0) break;
      if (selectedQuantities.has(option.id)) continue;
      total += resolveModifierOptionPrice(option);
      missingDistinct -= 1;
    }
    return roundCurrency(total);
  }

  // Reserve the cheapest not-yet-selected options when the group also has a
  // minimum of distinct options. The remaining units can repeat an option,
  // respecting its individual cap.
  for (const option of options) {
    if (missingDistinct <= 0) break;
    if (selectedQuantities.has(option.id)) continue;
    const cap = group.maxPerOption ?? Number.MAX_SAFE_INTEGER;
    const current = selectedQuantities.get(option.id) ?? 0;
    if (current + (added.get(option.id) ?? 0) >= cap) continue;
    added.set(option.id, 1);
    total += resolveModifierOptionPrice(option);
    missingDistinct -= 1;
    missingTotal = Math.max(0, missingTotal - 1);
  }

  for (const option of options) {
    if (missingTotal <= 0) break;
    const cap = group.maxPerOption ?? Number.MAX_SAFE_INTEGER;
    const current = selectedQuantities.get(option.id) ?? 0;
    const alreadyAdded = added.get(option.id) ?? 0;
    const available = Math.max(0, cap - current - alreadyAdded);
    const take = Math.min(available, missingTotal);
    if (take <= 0) continue;
    total += resolveModifierOptionPrice(option) * take;
    added.set(option.id, alreadyAdded + take);
    missingTotal -= take;
  }

  return roundCurrency(total);
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
