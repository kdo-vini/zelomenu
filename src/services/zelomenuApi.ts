// ZeloMenu public API client — plain fetch with relative paths.
// Types mirror zelochat's zelomenuApi.ts exactly so pages need zero adaptation.

import type {
  ZeloMenuModifierGroup,
  ZeloMenuModifierSelectionInput,
} from '../domain/zelomenuModifiers';

import type {
  ZeloMenuCartItem,
  ZeloMenuCartRevalidationIssue,
  ZeloMenuCartRevalidation,
} from '../domain/zelomenuCartSchema';

export type { ZeloMenuModifierGroup };
export type { ZeloMenuCartItem, ZeloMenuCartRevalidationIssue, ZeloMenuCartRevalidation };

// ─── Catalog types ─────────────────────────────────────────────────────────────

export type ZeloMenuCatalogProduct = {
  id: number;
  name: string;
  price: number;
  basePrice: number;
  available: boolean;
  description?: string | null;
  photoUrl?: string | null;
  sortOrder?: number;
  unitBased?: boolean;
  stockControlled?: boolean;
  stockQuantity?: number;
  modifierGroups: ZeloMenuModifierGroup[];
};

export type ZeloMenuCatalogGroup = {
  nome: string;
  subcategorias: Array<{ nome: string; produtos: ZeloMenuCatalogProduct[] }>;
  produtosDireto: ZeloMenuCatalogProduct[];
};

export type ZeloMenuPublicBusinessHoursStatus = {
  configured: boolean;
  openNow: boolean;
  label: string | null;
};

// ─── Cart types ────────────────────────────────────────────────────────────────
// ZeloMenuCartItem, ZeloMenuCartRevalidationIssue, ZeloMenuCartRevalidation
// are re-exported from src/domain/zelomenuCartSchema (canonical shared types).

export type ZeloMenuCartSessionPayload = {
  id: string;
  orderingId: string;
  context: 'whatsapp_order' | 'public_order' | 'table_order';
  state: string;
  revision: number;
  customer: {
    name: string | null;
    phone: string | null;
  };
  cart: {
    items: ZeloMenuCartItem[];
    observations: string | null;
  };
  fulfillment: {
    type: 'pickup' | 'delivery';
    asap?: boolean;
    pickupDate: string | null;
    pickupTime: string | null;
    deliveryAddress: string | null;
    deliveryNeighborhood: string | null;
    deliveryFee: number;
    deliveryFeeToConfirm: boolean;
  };
  pricing: {
    subtotal: number;
    deliveryFee: number;
    total: number;
  };
  payment: {
    declaredMethod: string | null;
    pixReceiptRequired: boolean;
    pixReceiptApproved: boolean;
  };
  metadata: Record<string, unknown>;
  lastRevalidatedAt: string | null;
  lastRevalidation: ZeloMenuCartRevalidation | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  archivedAt: string | null;
};

export type ZeloMenuPublicCartResponse = {
  session: ZeloMenuCartSessionPayload;
  business: {
    name: string;
    address: string;
    pixEnabled: boolean;
    deliveryEnabled: boolean;
    deliveryNeighborhoods: Array<{ name: string; fee: number }>;
    businessHours?: ZeloMenuPublicBusinessHoursStatus;
  };
  catalog: ZeloMenuCatalogGroup[];
  link: {
    path: string;
    tokenStatus: 'current' | 'stale';
  };
  revalidation: ZeloMenuCartRevalidation;
};

export type ZeloMenuConfirmCartResponse = ZeloMenuPublicCartResponse & {
  confirmation: {
    confirmed: boolean;
    alreadyConfirmed: boolean;
    state: string;
    customerMessage: string | null;
  };
};

export type ZeloMenuUpdateCartPayload = {
  customerName?: string | null;
  customerPhone?: string | null;
  items?: Array<{
    productId?: number | null;
    productName: string;
    quantity: number;
    notes?: string | null;
    selectedOptions?: ZeloMenuModifierSelectionInput[];
  }>;
  fulfillment?: {
    type?: 'pickup' | 'delivery';
    asap?: boolean;
    pickupDate?: string | null;
    pickupTime?: string | null;
    deliveryAddress?: string | null;
    deliveryNeighborhood?: string | null;
  };
  paymentMethod?: string | null;
  observations?: string | null;
};

export type ZeloMenuPublicStoreResponse = {
  business: {
    name: string;
    address: string;
    pixEnabled: boolean;
    deliveryEnabled: boolean;
    deliveryNeighborhoods: Array<{ name: string; fee: number }>;
    logoUrl?: string | null;
    welcomeText?: string | null;
    featuredEnabled?: boolean;
    featuredProductIds?: number[];
    businessHours?: ZeloMenuPublicBusinessHoursStatus;
  };
  catalog: ZeloMenuCatalogGroup[];
};

// ─── Mesa types ────────────────────────────────────────────────────────────────

export interface MesaContextResponse {
  comanda_id?: string;
  comanda_status?: string;
  mesa_numero?: string;
  error?: 'SEM_COMANDA' | 'MESA_NOT_FOUND';
}

export interface TableOrderContext {
  mesa_id: string;
  comanda_id: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((body as { error?: string; message?: string }).error || (body as { error?: string; message?: string }).message || `HTTP ${response.status}`);
  }
  return body as T;
}

export async function getMesaContext(
  slug: string,
  mesaId: string,
): Promise<MesaContextResponse> {
  const response = await fetch(
    `/api/public/zelomenu/mesa/${encodeURIComponent(mesaId)}?slug=${encodeURIComponent(slug)}`,
  );
  return parseResponse<MesaContextResponse>(response);
}

// ─── Endpoints ─────────────────────────────────────────────────────────────────

export async function getPublicCart(token: string): Promise<ZeloMenuPublicCartResponse> {
  const response = await fetch(`/api/public/zelomenu/cart/${encodeURIComponent(token)}`, {
    cache: 'no-store',
  });
  return parseResponse<ZeloMenuPublicCartResponse>(response);
}

export async function updatePublicCart(
  token: string,
  payload: ZeloMenuUpdateCartPayload,
): Promise<ZeloMenuPublicCartResponse> {
  const response = await fetch(`/api/public/zelomenu/cart/${encodeURIComponent(token)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseResponse<ZeloMenuPublicCartResponse>(response);
}

export async function confirmPublicCart(token: string): Promise<ZeloMenuConfirmCartResponse> {
  const response = await fetch(`/api/public/zelomenu/cart/${encodeURIComponent(token)}/confirm`, {
    method: 'POST',
  });
  return parseResponse<ZeloMenuConfirmCartResponse>(response);
}

export async function getPublicStore(slug: string): Promise<ZeloMenuPublicStoreResponse> {
  const response = await fetch(`/api/public/zelomenu/store/${encodeURIComponent(slug)}`, {
    cache: 'no-store',
  });
  return parseResponse<ZeloMenuPublicStoreResponse>(response);
}

export async function startPublicOrder(
  slug: string,
  payload: {
    customerName?: string | null;
    customerPhone?: string | null;
    items: ZeloMenuUpdateCartPayload['items'];
    tableOrderContext?: TableOrderContext;
  },
): Promise<{ token: string; path: string; orderingId: string }> {
  const response = await fetch(`/api/public/zelomenu/store/${encodeURIComponent(slug)}/cart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      ...(payload.tableOrderContext
        ? {
            context: 'table_order',
            mesa_id: payload.tableOrderContext.mesa_id,
            comanda_id: payload.tableOrderContext.comanda_id,
          }
        : {}),
    }),
  });
  return parseResponse<{ token: string; path: string; orderingId: string }>(response);
}
