import { parseDecimal } from './deliverySettings.js';

export type DeliveryNeighborhood = {
  id: string;
  name: string;
  normalizedName: string;
  price: number;
  active: boolean;
  sortOrder: number;
};

export type DeliveryNeighborhoodDraft = {
  id?: string;
  name: string;
  price: string;
  active: boolean;
};

export function normalizeDeliveryNeighborhoodName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ');
}

export function resolveDeliveryNeighborhoodFee(
  neighborhoods: DeliveryNeighborhood[],
  neighborhoodId: string | null | undefined,
): { id: string; name: string; fee: number } | null {
  if (!neighborhoodId) return null;
  const neighborhood = neighborhoods.find((item) => item.id === neighborhoodId && item.active);
  return neighborhood
    ? { id: neighborhood.id, name: neighborhood.name, fee: neighborhood.price }
    : null;
}

export function validateDeliveryNeighborhoods(
  drafts: DeliveryNeighborhoodDraft[],
): Array<string | null> {
  const normalizedNames = drafts.map((draft) => normalizeDeliveryNeighborhoodName(draft.name));
  return drafts.map((draft, index) => {
    if (!normalizedNames[index]) return 'Informe o nome do bairro.';
    const price = parseDecimal(draft.price);
    if (price == null || price < 0) return 'Informe um valor de frete válido.';
    if (normalizedNames.indexOf(normalizedNames[index]) !== index) {
      return 'Não use o mesmo bairro mais de uma vez.';
    }
    return null;
  });
}

export function deliveryNeighborhoodDraftsToSettings(
  drafts: DeliveryNeighborhoodDraft[],
): Array<Omit<DeliveryNeighborhood, 'id'> & { id?: string }> {
  return drafts.flatMap((draft, index) => {
    const price = parseDecimal(draft.price);
    const normalizedName = normalizeDeliveryNeighborhoodName(draft.name);
    if (!normalizedName || price == null || price < 0) return [];
    return [{
      id: draft.id,
      name: draft.name.trim(),
      normalizedName,
      price,
      active: draft.active,
      sortOrder: index,
    }];
  });
}
