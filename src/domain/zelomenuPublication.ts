import type { ZeloMenuModifierGroup } from './zelomenuModifiers';
import { resolveCatalogProductAvailability } from './zelomenuCatalog';

export type ZeloMenuPublicationProduct = {
  id: number;
  nome: string;
  id_categoria: number | null;
  controlar_estoque: boolean;
  estoque_atual: number;
  ocultar_no_pdv: boolean;
  publication?: ZeloMenuProductPublication | null;
  modifierGroups?: ZeloMenuModifierGroup[] | null;
};

export type ZeloMenuProductPublication = {
  id_produto: number;
  nome_publico: string | null;
  descricao_publica: string | null;
  foto_url: string | null;
  visivel_online: boolean;
  pausado_manualmente: boolean;
  ordem: number;
};

export type ZeloMenuPublicationStatus =
  | 'published'
  | 'unpublished'
  | 'paused'
  | 'hidden'
  | 'out_of_stock'
  | 'missing_category';

export type ZeloMenuPublicationIssue = Exclude<ZeloMenuPublicationStatus, 'published'>;

export type ZeloMenuPublicationStatusDetails = {
  status: ZeloMenuPublicationStatus;
  label: string;
  description: string;
  issue: ZeloMenuPublicationIssue | null;
};

export type ZeloMenuPublicationSummary = {
  total: number;
  published: number;
  unpublished: number;
  paused: number;
  hidden: number;
  outOfStock: number;
  missingCategory: number;
  attention: number;
};

export type ZeloMenuPublicationCatalogProduct = ZeloMenuPublicationProduct & {
  id: number;
  name: string;
  price: number;
  unitBased?: boolean;
  stockControlled?: boolean;
  stockQuantity?: number;
};

export type ZeloMenuResolvedCatalogProduct = {
  id: number;
  name: string;
  price: number;
  basePrice: number;
  available: boolean;
  description: string | null;
  photoUrl: string | null;
  sortOrder: number;
  unitBased?: boolean;
  stockControlled?: boolean;
  stockQuantity?: number;
  modifierGroups: ZeloMenuModifierGroup[];
};

export function getZeloMenuPublicationStatus(
  product: ZeloMenuPublicationProduct,
): ZeloMenuPublicationStatusDetails {
  if (product.controlar_estoque && product.estoque_atual <= 0) {
    return {
      status: 'out_of_stock',
      label: 'Sem estoque',
      description: 'Produto com estoque controlado zerado.',
      issue: 'out_of_stock',
    };
  }

  const availability = resolveCatalogProductAvailability(product, product.modifierGroups);
  if (availability.state === 'blocked_by_required_options') {
    return {
      status: 'hidden',
      label: 'Ocultado automaticamente',
      description: `Grupo obrigatório sem opções suficientes: ${availability.reason ?? 'revise as opções disponíveis.'}`,
      issue: 'hidden',
    };
  }

  if (!product.publication?.visivel_online) {
    return {
      status: 'unpublished',
      label: 'Somente complemento',
      description: 'Produto salvo para uso como complemento; não é vendido separadamente.',
      issue: 'unpublished',
    };
  }

  if (product.publication.pausado_manualmente) {
    return {
      status: 'paused',
      label: 'Pausado',
      description: 'Produto pausado temporariamente no cardápio digital.',
      issue: 'paused',
    };
  }

  if (product.id_categoria == null) {
    return {
      status: 'missing_category',
      label: 'Sem categoria',
      description: 'Produto precisa estar em uma categoria para aparecer bem no link do cardápio.',
      issue: 'missing_category',
    };
  }

  return {
    status: 'published',
    label: 'Publicado',
    description: 'Produto publicado e disponível no link do cardápio.',
    issue: null,
  };
}

export function summarizeZeloMenuPublication(
  products: ZeloMenuPublicationProduct[],
): ZeloMenuPublicationSummary {
  const summary: ZeloMenuPublicationSummary = {
    total: products.length,
    published: 0,
    unpublished: 0,
    paused: 0,
    hidden: 0,
    outOfStock: 0,
    missingCategory: 0,
    attention: 0,
  };

  for (const product of products) {
    const details = getZeloMenuPublicationStatus(product);
    if (details.status === 'published') {
      summary.published += 1;
      continue;
    }

    summary.attention += 1;
    if (details.status === 'unpublished') summary.unpublished += 1;
    if (details.status === 'paused') summary.paused += 1;
    if (details.status === 'hidden') summary.hidden += 1;
    if (details.status === 'out_of_stock') summary.outOfStock += 1;
    if (details.status === 'missing_category') summary.missingCategory += 1;
  }

  return summary;
}

/**
 * Whether a product can be used as a modifier-option ingredient inside a
 * combo (e.g. "Penne" inside "Monte sua Massa"). A product intentionally
 * unpublished from its own online listing may still be a component, but an
 * item hidden in the PDV remains eligible here because PDV visibility is an
 * internal sales-channel setting. Stock-out is still a hard availability
 * boundary.
 */
export function resolveZeloMenuLinkedOptionAvailability(
  product: Pick<ZeloMenuPublicationCatalogProduct, 'controlar_estoque' | 'estoque_atual'>
    & Partial<Pick<ZeloMenuPublicationCatalogProduct, 'ocultar_no_pdv' | 'publication'>>,
): boolean {
  if (product.publication?.pausado_manualmente) return false;
  return resolveCatalogProductAvailability(product, []).available;
}

export function resolveZeloMenuPublicationCatalogProduct(
  product: ZeloMenuPublicationCatalogProduct,
): ZeloMenuResolvedCatalogProduct {
  const details = getZeloMenuPublicationStatus(product);
  const availability = resolveCatalogProductAvailability(product, product.modifierGroups);

  return {
    id: product.id,
    name: product.publication?.nome_publico || product.name,
    price: product.price,
    basePrice: product.price,
    available: details.status === 'published' && availability.available,
    description: product.publication?.descricao_publica ?? null,
    photoUrl: product.publication?.foto_url ?? null,
    sortOrder: product.publication?.ordem ?? 0,
    unitBased: product.unitBased,
    stockControlled: product.stockControlled,
    stockQuantity: product.stockQuantity,
    modifierGroups: product.modifierGroups ?? [],
  };
}
