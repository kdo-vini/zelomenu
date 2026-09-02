export type ConversationModifierOptionDefinition = {
  id: string;
  name: string;
  currentPrice: number;
  priceDelta: number;
  available: boolean;
  order: number;
};

export type ConversationModifierGroupDefinition = {
  id: string;
  name: string;
  kind: 'adicional' | 'variacao';
  pricingMode: 'somar' | 'substituir';
  minSelections: number;
  maxSelections: number | null;
  minTotalQuantity: number;
  maxTotalQuantity: number | null;
  allowsQuantity: boolean;
  maxPerOption: number | null;
  order: number;
  options: readonly ConversationModifierOptionDefinition[];
};

export type ConversationCatalogProductDefinition = {
  id: number;
  name: string;
  basePrice: number;
  available: boolean;
  modifierGroups: readonly ConversationModifierGroupDefinition[];
};

export type ConversationRequirementLine = {
  lineId: string;
  productId: number;
  selectedOptions?: readonly {
    groupId: string;
    optionSelections: readonly { optionId: string; quantity: number }[];
  }[];
};

export type OrderingRequirement = {
  id: string;
  type: 'modifier_group';
  lineId: string;
  productId: number;
  groupId: string;
  name: string;
  blocking: boolean;
  kind: ConversationModifierGroupDefinition['kind'];
  pricingMode: ConversationModifierGroupDefinition['pricingMode'];
  minSelections: number;
  maxSelections: number | null;
  minTotalQuantity: number;
  maxTotalQuantity: number | null;
  allowsQuantity: boolean;
  maxPerOption: number | null;
  selectedDistinctCount: number;
  selectedTotalQuantity: number;
  autoSelectableOptionId?: string;
  options: ConversationModifierOptionDefinition[];
};

export type FulfillmentTypeOrderingRequirement = {
  id: 'fulfillment_type';
  type: 'fulfillment_type';
  name: string;
  blocking: true;
};

export const FULFILLMENT_TYPE_REQUIREMENT: FulfillmentTypeOrderingRequirement = {
  id: 'fulfillment_type',
  type: 'fulfillment_type',
  name: 'Escolha entrega ou retirada.',
  blocking: true,
};

function byDisplayOrder<T extends { order: number; name: string }>(left: T, right: T): number {
  return left.order - right.order || left.name.localeCompare(right.name, 'pt-BR');
}

function selectionsForGroup(line: ConversationRequirementLine, groupId: string) {
  return (line.selectedOptions ?? [])
    .filter((selection) => selection.groupId === groupId)
    .flatMap((selection) => selection.optionSelections);
}

function selectedQuantities(
  line: ConversationRequirementLine,
  group: ConversationModifierGroupDefinition,
): Map<string, number> {
  const availableOptions = new Set(group.options.filter((option) => option.available).map((option) => option.id));
  const quantities = new Map<string, number>();

  for (const selection of selectionsForGroup(line, group.id)) {
    if (!availableOptions.has(selection.optionId)) {
      throw new Error(`MODIFIER_OPTION_UNAVAILABLE:${selection.optionId}`);
    }
    if (!Number.isSafeInteger(selection.quantity) || selection.quantity < 1) {
      throw new Error(`MODIFIER_QUANTITY_INVALID:${group.id}`);
    }
    if (!group.allowsQuantity && selection.quantity !== 1) {
      throw new Error(`MODIFIER_QUANTITY_INVALID:${group.id}`);
    }

    const total = (quantities.get(selection.optionId) ?? 0) + selection.quantity;
    if (!Number.isSafeInteger(total)) throw new Error(`MODIFIER_QUANTITY_INVALID:${group.id}`);
    quantities.set(selection.optionId, total);
  }

  return quantities;
}

function validateUpperBounds(
  group: ConversationModifierGroupDefinition,
  quantities: Map<string, number>,
): { distinctCount: number; totalQuantity: number } {
  const distinctCount = quantities.size;
  const totalQuantity = [...quantities.values()].reduce((total, quantity) => total + quantity, 0);

  if (group.maxSelections != null && distinctCount > group.maxSelections) {
    throw new Error(`MODIFIER_DISTINCT_SELECTIONS_EXCEEDED:${group.id}`);
  }
  if (group.maxTotalQuantity != null && totalQuantity > group.maxTotalQuantity) {
    throw new Error(`MODIFIER_TOTAL_QUANTITY_EXCEEDED:${group.id}`);
  }
  if (group.maxPerOption != null && [...quantities.values()].some((quantity) => quantity > group.maxPerOption!)) {
    throw new Error(`MODIFIER_OPTION_QUANTITY_EXCEEDED:${group.id}`);
  }

  return { distinctCount, totalQuantity };
}

export function deriveModifierRequirements(
  lines: readonly ConversationRequirementLine[],
  products: readonly ConversationCatalogProductDefinition[],
): OrderingRequirement[] {
  const productsById = new Map(products.map((product) => [product.id, product]));
  const requirements: OrderingRequirement[] = [];

  for (const line of lines) {
    const product = productsById.get(line.productId);
    if (!product) throw new Error(`PRODUCT_NOT_FOUND:${line.productId}`);

    const groupsById = new Map(product.modifierGroups.map((group) => [group.id, group]));
    for (const selection of line.selectedOptions ?? []) {
      const group = groupsById.get(selection.groupId);
      if (!group) {
        throw new Error(`MODIFIER_GROUP_OUTSIDE_PRODUCT:${selection.groupId}`);
      }
      const productOptionIds = new Set(product.modifierGroups.flatMap((candidate) => candidate.options.map((option) => option.id)));
      const groupOptionIds = new Set(group.options.map((option) => option.id));
      for (const optionSelection of selection.optionSelections) {
        if (!productOptionIds.has(optionSelection.optionId)) {
          throw new Error(`MODIFIER_OPTION_OUTSIDE_PRODUCT:${optionSelection.optionId}`);
        }
        if (!groupOptionIds.has(optionSelection.optionId)) {
          throw new Error(`MODIFIER_OPTION_OUTSIDE_GROUP:${optionSelection.optionId}`);
        }
      }
    }

    for (const group of [...product.modifierGroups].sort(byDisplayOrder)) {
      const options = group.options.filter((option) => option.available).sort(byDisplayOrder);
      const quantities = selectedQuantities(line, group);
      const { distinctCount, totalQuantity } = validateUpperBounds(group, quantities);
      const blocking = distinctCount < group.minSelections || totalQuantity < group.minTotalQuantity;
      const isRequired = group.minSelections > 0 || group.minTotalQuantity > 0;
      if (isRequired && !blocking) continue;

      requirements.push({
        id: `${line.lineId}:${group.id}`,
        type: 'modifier_group',
        lineId: line.lineId,
        productId: line.productId,
        groupId: group.id,
        name: group.name,
        blocking,
        kind: group.kind,
        pricingMode: group.pricingMode,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        minTotalQuantity: group.minTotalQuantity,
        maxTotalQuantity: group.maxTotalQuantity,
        allowsQuantity: group.allowsQuantity,
        maxPerOption: group.maxPerOption,
        selectedDistinctCount: distinctCount,
        selectedTotalQuantity: totalQuantity,
        ...(isRequired && options.length === 1 ? { autoSelectableOptionId: options[0].id } : {}),
        options,
      });
    }
  }

  return requirements;
}
