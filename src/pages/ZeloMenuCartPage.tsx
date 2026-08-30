import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Banknote,
  Bike,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  Copy,
  CreditCard,
  ImageIcon,
  Loader2,
  MessageCircle,
  Minus,
  Plus,
  QrCode,
  RefreshCw,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  UtensilsCrossed,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import {
  confirmPublicCart,
  ZeloMenuApiError,
  getPublicCart,
  lookupPublicDeliveryCep,
  updatePublicCart,
  type ZeloMenuCatalogGroup,
  type ZeloMenuCatalogProduct,
  type ZeloMenuCartRevalidationIssue,
  type ZeloMenuPublicCartResponse,
  type ZeloMenuUpdateCartPayload,
} from '../services/zelomenuApi';
import {
  formatModifierAwareCartItem,
  resolveModifierSelections,
  type ZeloMenuModifierSelectionInput,
  type ZeloMenuSelectedModifierGroup,
} from '../domain/zelomenuModifiers';
import { normalizePublicOrderStatus, resolveOrderStatus } from '../domain/zelomenuOrderStatus';
import {
  businessDayLabel,
  parseBusinessTime,
} from '../domain/zelomenuBusinessHours';
import {
  validateScheduling,
  resolveEarliestPickup,
  availablePickupSlots,
} from '../domain/zelomenuScheduling';
import type { DayKey } from '../domain/businessHours';
import {
  firstZeloMenuCheckoutError,
  validateZeloMenuCheckoutDetails,
} from '../domain/zelomenuCheckout';
import { formatEstimatedDeliveryMinutes } from '../domain/deliverySettings';
import type { ZeloMenuCartSnapshot } from '../domain/zelomenuCartSchema';
import { syncZeloMenuStoreCartCache } from '../domain/zelomenuStoreCartCache';
import { buildPublicStorePath } from '../domain/zelomenuSlug';
import { maskBrazilianPhone, normalizePhoneNumber } from '../domain/chat';
import {
  clearZeloMenuCustomerCache,
  hasZeloMenuCustomerCacheConsent,
  loadZeloMenuCustomerCache,
  saveZeloMenuCustomerCache,
  setZeloMenuCustomerCacheConsent,
} from '../domain/zelomenuCustomerCache';
import { buildWhatsAppOrderMessage, buildWhatsAppOrderLink } from '../domain/whatsappOrder';
import { ModifierModal } from '../components/zelomenu/ZeloMenuModifierModal';
import { ZeloMenuScheduleCalendar } from '../components/zelomenu/ZeloMenuScheduleCalendar';
import { PushNotificationButton } from '../components/home/PushNotificationButton';
import { resolveCheckoutSuggestions } from '../domain/zelomenuRecommendations';
import { resolvePublicPushOrderId } from '../domain/zelomenuPush';
import { ToastProvider, useToast } from '../contexts/ToastContext';

type DraftState = {
  customerName: string;
  customerPhone: string;
  items: Array<{
    productId: number | null;
    productName: string;
    quantity: number;
    notes: string;
    selectedOptions: ZeloMenuModifierSelectionInput[];
    selectedModifiers: ZeloMenuSelectedModifierGroup[];
    baseUnitPrice: number;
    modifierDeltaTotal: number;
  }>;
  fulfillmentType: 'pickup' | 'delivery';
  pickupDate: string;
  pickupTime: string;
  deliveryAddress: string;
  deliveryNeighborhood: string;
  deliveryPostalCode: string;
  deliveryNumber: string;
  deliveryComplement: string;
  deliveryStreet: string;
  deliveryCity: string;
  deliveryState: string;
  paymentMethod: string;
  observations: string;
  couponCode: string;
};

function composeDeliveryAddress(fields: Pick<DraftState, 'deliveryStreet' | 'deliveryNumber' | 'deliveryComplement' | 'deliveryNeighborhood' | 'deliveryCity' | 'deliveryState'>): string {
  const streetLine = [fields.deliveryStreet, fields.deliveryNumber, fields.deliveryComplement]
    .filter(Boolean)
    .join(', ');
  const locality = [fields.deliveryNeighborhood, fields.deliveryCity]
    .filter(Boolean)
    .join(' · ');
  const region = [locality, fields.deliveryState].filter(Boolean).join(' - ');
  return [streetLine, region].filter(Boolean).join(' — ');
}

type AutosaveResult = ZeloMenuPublicCartResponse | null;

const PAYMENT_OPTIONS = ['Pix', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Outro'] as const;
const AUTOSAVE_DEBOUNCE_MS = 650;
const DELIVERY_QUOTE_DEBOUNCE_MS = 1000;

function toBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function todayISOdate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function nowTimeBR(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
}

function buildDraftFromPayload(
  payload: ZeloMenuPublicCartResponse,
  cart: ZeloMenuCartSnapshot = payload.session.cart,
): DraftState {
  return {
    customerName: payload.session.customer.name ?? '',
    customerPhone: maskBrazilianPhone(payload.session.customer.phone ?? ''),
    items: cart.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      notes: item.notes ?? '',
      selectedOptions: item.selectedModifiers.map((group) => ({
        groupId: group.groupId,
        optionSelections: group.selectedOptions.map((option) => ({
          optionId: option.optionId,
          quantity: option.quantity ?? 1,
        })),
      })),
      selectedModifiers: item.selectedModifiers,
      baseUnitPrice: item.baseUnitPrice,
      modifierDeltaTotal: item.modifierDeltaTotal,
    })),
    fulfillmentType: payload.session.fulfillment.type,
    pickupDate: payload.session.fulfillment.pickupDate ?? todayISOdate(),
    pickupTime: payload.session.fulfillment.pickupTime ?? nowTimeBR(),
    deliveryAddress: payload.session.fulfillment.deliveryAddress ?? '',
    deliveryNeighborhood: payload.session.fulfillment.deliveryNeighborhood ?? '',
    deliveryPostalCode: payload.session.fulfillment.deliveryPostalCode ?? '',
    deliveryNumber: payload.session.fulfillment.deliveryNumber ?? '',
    deliveryComplement: payload.session.fulfillment.deliveryComplement ?? '',
    deliveryStreet: payload.session.fulfillment.deliveryStreet ?? '',
    deliveryCity: payload.session.fulfillment.deliveryCity ?? '',
    deliveryState: payload.session.fulfillment.deliveryState ?? '',
    paymentMethod: payload.session.payment.declaredMethod ?? '',
    observations: cart.observations ?? '',
    couponCode: payload.session.pricing.couponCode ?? '',
  };
}

function deriveScheduleMode(payload: ZeloMenuPublicCartResponse): 'asap' | 'scheduled' {
  const f = payload.session.fulfillment;
  const scheduled = f.asap === true
    ? false
    : Boolean(f.pickupTime) || (Boolean(f.pickupDate) && f.pickupDate !== todayISOdate());
  return scheduled ? 'scheduled' : 'asap';
}

function catalogProductMap(groups: ZeloMenuCatalogGroup[]): Map<number, ZeloMenuCatalogProduct> {
  const next = new Map<number, ZeloMenuCatalogProduct>();
  for (const group of groups) {
    for (const product of group.produtosDireto) {
      next.set(product.id, product);
    }
    for (const subcategory of group.subcategorias) {
      for (const product of subcategory.produtos) {
        next.set(product.id, product);
      }
    }
  }
  return next;
}

function estimateDraftTotals(
  draft: DraftState,
  catalog: ZeloMenuCatalogGroup[],
  serverDelivery?: ZeloMenuPublicCartResponse['session']['fulfillment'],
) {
  const products = catalogProductMap(catalog);
  const items = draft.items.flatMap((item) => {
    const product = item.productId != null ? products.get(item.productId) : null;
    const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
    if (quantity === 0) return [];
    let unitPrice = item.baseUnitPrice + item.modifierDeltaTotal;
    let selectedModifiers = item.selectedModifiers;
    if (product) {
      const resolved = resolveModifierSelections(product.modifierGroups, item.selectedOptions, product.basePrice);
      if (resolved.ok) {
        unitPrice = Number(resolved.finalUnitPrice.toFixed(2));
        selectedModifiers = resolved.selectedGroups;
      }
    }
    const lineTotal = quantity * Number(unitPrice || 0);
    return [{
      productId: item.productId,
      productName: product?.name ?? item.productName,
      selectedModifiers,
      quantity,
      unitPrice,
      lineTotal,
      notes: item.notes || null,
    }];
  });
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const quoteMatchesDraft = deliveryQuoteMatchesDraft(draft, serverDelivery);
  const deliveryFee = quoteMatchesDraft ? Number(serverDelivery?.deliveryFee ?? 0) : 0;
  const deliveryFeeToConfirm = draft.fulfillmentType === 'delivery'
    && (!quoteMatchesDraft || serverDelivery?.deliveryFeeToConfirm === true);
  return {
    items,
    subtotal,
    deliveryFee,
    deliveryFeeToConfirm,
    total: subtotal + deliveryFee,
    discount: 0,
    couponLabel: null as string | null,
  };
}

type DeliveryQuoteUiState = 'not_applicable' | 'missing_address' | 'calculating' | 'ready' | 'out_of_area' | 'unavailable';

function deliveryQuoteMatchesDraft(
  draft: DraftState,
  serverDelivery?: ZeloMenuPublicCartResponse['session']['fulfillment'],
): boolean {
  const normalizedDraftPostalCode = draft.deliveryPostalCode.replace(/\D/g, '');
  const normalizedServerPostalCode = (serverDelivery?.deliveryPostalCode ?? '').replace(/\D/g, '');
  return draft.fulfillmentType === 'delivery'
    && serverDelivery?.type === 'delivery'
    && normalizedDraftPostalCode.length === 8
    && normalizedDraftPostalCode === normalizedServerPostalCode
    && draft.deliveryNumber.trim() === (serverDelivery.deliveryNumber ?? '').trim()
    && draft.deliveryComplement.trim() === (serverDelivery.deliveryComplement ?? '').trim();
}

function resolveDeliveryQuoteUiState(
  draft: DraftState | null,
  payload: ZeloMenuPublicCartResponse | null,
  saveFailed = false,
): DeliveryQuoteUiState {
  if (!draft || draft.fulfillmentType !== 'delivery') return 'not_applicable';
  const postalCode = draft.deliveryPostalCode.replace(/\D/g, '');
  if (postalCode.length !== 8 || !draft.deliveryNumber.trim()) return 'missing_address';

  const serverDelivery = payload?.session.fulfillment;
  if (!deliveryQuoteMatchesDraft(draft, serverDelivery)) return saveFailed ? 'unavailable' : 'calculating';
  if (serverDelivery?.deliveryStatus === 'out_of_area') return 'out_of_area';
  if (
    serverDelivery?.deliveryStatus === 'eligible'
    || serverDelivery?.deliveryStatus === 'eligible_stale'
  ) {
    return serverDelivery.deliveryFeeToConfirm ? 'unavailable' : 'ready';
  }
  return 'unavailable';
}


function isKnownPaymentMethod(value: string): boolean {
  return PAYMENT_OPTIONS.some((option) => option === value);
}

function draftItemKey(item: DraftState['items'][number]): string {
  const idPart = item.productId ?? item.productName;
  const selections = item.selectedOptions
    .map((group) => {
      const sorted = [...group.optionSelections]
        .map((s) => `${s.optionId}:${s.quantity}`)
        .sort()
        .join(',');
      return `${group.groupId}:${sorted}`;
    })
    .sort()
    .join('|');
  const normalizedNotes = item.notes.trim();
  return `${idPart}::${selections || 'plain'}${normalizedNotes ? `::note:${normalizedNotes}` : ''}`;
}

function selectedOptionsFromSelectedModifiers(
  selectedModifiers: ZeloMenuSelectedModifierGroup[],
): ZeloMenuModifierSelectionInput[] {
  return selectedModifiers.map((group) => ({
    groupId: group.groupId,
    optionSelections: group.selectedOptions.map((option) => ({
      optionId: option.optionId,
      quantity: option.quantity ?? 1,
    })),
  }));
}

function estimatedItemKey(
  item: {
    productId: number | null;
    productName: string;
    quantity: number;
    notes?: string | null;
    selectedModifiers: ZeloMenuSelectedModifierGroup[];
    unitPrice: number;
  },
): string {
  return draftItemKey({
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    notes: item.notes ?? '',
    selectedOptions: selectedOptionsFromSelectedModifiers(item.selectedModifiers),
    selectedModifiers: item.selectedModifiers,
    baseUnitPrice: item.unitPrice,
    modifierDeltaTotal: 0,
  });
}

function revalidationSignature(issues: ZeloMenuCartRevalidationIssue[]): string {
  return issues
    .map((issue) => `${issue.code}:${issue.message}`)
    .join('|');
}

function buildRevalidationToastMessage(issues: ZeloMenuCartRevalidationIssue[]): string | null {
  // A pending delivery quote is rendered by the dedicated loading/error UI.
  // Showing it as a toast makes slow typing look like a checkout failure.
  if (issues.some((issue) => issue.code === 'delivery_quote_pending')) return null;
  const deliveryOutOfArea = issues.find((issue) => issue.code === 'delivery_out_of_area');
  if (deliveryOutOfArea) return deliveryOutOfArea.message;
  const priceIssue = issues.find((issue) => issue.code === 'price_changed');
  if (priceIssue) {
    return `${priceIssue.message} Confira o novo total e toque em Confirmar pedido novamente.`;
  }
  const couponIssue = issues.find((issue) =>
    issue.code === 'coupon_invalid' || issue.code === 'coupon_expired' || issue.code === 'coupon_min_not_met' || issue.code === 'coupon_already_used',
  );
  if (couponIssue) {
    return `${couponIssue.message} Remova ou troque o cupom e tente novamente.`;
  }
  const [firstIssue] = issues;
  const detail = firstIssue?.message ? ` ${firstIssue.message}` : '';
  const suffix = issues.length > 1 ? ` Há mais ${issues.length - 1} ajuste(s) no carrinho.` : '';
  return `Seu carrinho precisa de revisão.${detail}${suffix}`;
}

function buildCartUpdatePayload(
  draft: DraftState,
  scheduleMode: 'asap' | 'scheduled',
  expectedRevision: number,
): ZeloMenuUpdateCartPayload {
  const pickupDate = scheduleMode === 'asap' ? todayISOdate() : draft.pickupDate;
  const pickupTime = scheduleMode === 'asap' ? nowTimeBR() : draft.pickupTime;
  return {
    expectedRevision,
    customerName: draft.customerName || null,
    customerPhone: normalizePhoneNumber(draft.customerPhone).slice(0, 11) || null,
    items: draft.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      notes: item.notes || null,
      selectedOptions: item.selectedOptions,
    })),
    fulfillment: {
      type: draft.fulfillmentType,
      asap: scheduleMode === 'asap',
      pickupDate: pickupDate || null,
      pickupTime: pickupTime || null,
      deliveryAddress: draft.fulfillmentType === 'delivery' ? (draft.deliveryAddress || null) : null,
      deliveryNeighborhood: draft.fulfillmentType === 'delivery' ? (draft.deliveryNeighborhood || null) : null,
      deliveryPostalCode: draft.fulfillmentType === 'delivery' ? (draft.deliveryPostalCode || null) : null,
      deliveryNumber: draft.fulfillmentType === 'delivery' ? (draft.deliveryNumber || null) : null,
      deliveryComplement: draft.fulfillmentType === 'delivery' ? (draft.deliveryComplement || null) : null,
      deliveryStreet: draft.fulfillmentType === 'delivery' ? (draft.deliveryStreet || null) : null,
      deliveryCity: draft.fulfillmentType === 'delivery' ? (draft.deliveryCity || null) : null,
      deliveryState: draft.fulfillmentType === 'delivery' ? (draft.deliveryState || null) : null,
    },
    paymentMethod: draft.paymentMethod || null,
    couponCode: draft.couponCode || null,
    observations: draft.observations || null,
  };
}

function syncStoreCacheFromResponse(response: ZeloMenuPublicCartResponse): void {
  const slug = typeof response.session.metadata.slug === 'string'
    ? response.session.metadata.slug
    : null;
  syncZeloMenuStoreCartCache({
    slug,
    state: response.session.state,
    items: response.session.cart.items,
  });
}

// ── Tela "pedido confirmado" — copy dinâmica por status ─────────────────────

function resolveConfirmedStatusCopy(
  orderStatus: string,
  isDelivery: boolean,
  isTableOrder: boolean,
): { title: string; description: string } {
  if (isTableOrder && !['accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'rejected', 'cancelled'].includes(orderStatus)) {
    return { title: 'Pedido enviado!', description: 'Seu pedido já está na fila da cozinha.' };
  }
  switch (orderStatus) {
    case 'pending_review':
      return { title: 'Seu pedido foi enviado à loja', description: 'Estamos aguardando a confirmação da loja.' };
    case 'pending_payment':
      return { title: 'Falta o pagamento via Pix', description: 'Pague com o Pix abaixo e envie o comprovante.' };
    case 'accepted':
      return { title: 'Pedido confirmado!', description: 'A loja aceitou seu pedido.' };
    case 'preparing':
      return { title: 'Seu pedido está em preparo', description: 'A loja já começou a preparar seu pedido.' };
    case 'ready':
      return {
        title: 'Seu pedido está pronto!',
        description: isDelivery ? 'Logo sai para entrega.' : 'Você já pode retirar na loja.',
      };
    case 'out_for_delivery':
      return { title: 'Saiu para entrega', description: 'Seu pedido está a caminho.' };
    case 'delivered':
      return {
        title: isDelivery ? 'Pedido entregue' : 'Pedido retirado',
        description: 'Esperamos que você aproveite!',
      };
    case 'rejected':
      return { title: 'Pedido não aceito', description: 'Infelizmente a loja não pôde aceitar seu pedido.' };
    case 'cancelled':
      return { title: 'Pedido cancelado', description: 'Este pedido foi cancelado.' };
    default:
      return { title: 'Pedido enviado!', description: 'A loja recebeu seu pedido.' };
  }
}

function resolveConfirmedNextStep(orderStatus: string, isDelivery: boolean, isTableOrder = false): string | null {
  switch (orderStatus) {
    case 'pending_review':
      return isTableOrder
        ? 'A cozinha recebeu seu pedido. A equipe avisará quando houver uma atualização.'
        : 'A loja vai confirmar seu pedido em instantes. Você será avisado automaticamente.';
    case 'pending_payment':
      return 'Depois de pagar, envie o comprovante no WhatsApp da loja.';
    case 'accepted':
      return 'A loja já confirmou e vai começar o preparo do seu pedido em instantes.';
    case 'preparing':
      return isDelivery ? 'Avisamos quando sair para entrega.' : 'Avisamos quando estiver pronto.';
    case 'ready':
      return isDelivery
        ? 'Seu pedido vai sair para entrega em instantes.'
        : 'Assim que chegar, é só falar com a loja para retirar.';
    case 'out_for_delivery':
      return 'O entregador está a caminho. Fique de olho no WhatsApp para combinar a entrega.';
    default:
      // rejected, cancelled, delivered (e outros estados terminais) não têm próximo passo.
      return null;
  }
}

function ZeloMenuCartPageContent() {
  const { token = '' } = useParams();
  const toast = useToast();
  const [payload, setPayload] = useState<ZeloMenuPublicCartResponse | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [scheduleMode, setScheduleMode] = useState<'asap' | 'scheduled'>('asap');
  const [showErrors, setShowErrors] = useState(false);
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [rememberCustomerData, setRememberCustomerData] = useState(false);
  const [deliveryCepLoading, setDeliveryCepLoading] = useState(false);
  const [deliveryAddressEditing, setDeliveryAddressEditing] = useState(false);
  const revalidationToastShownRef = useRef('');
  const autosaveReadyRef = useRef(false);
  const customerCacheHydratedRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueueRef = useRef<Promise<AutosaveResult>>(Promise.resolve(null));
  const saveVersionRef = useRef(0);
  const latestAutosaveRef = useRef<ZeloMenuUpdateCartPayload | null>(null);
  const loadRequestRef = useRef(0);
  const [recModalProduct, setRecModalProduct] = useState<ZeloMenuCatalogProduct | null>(null);
  const [recModalSelections, setRecModalSelections] = useState<Record<string, Record<string, number>>>({});
  const pixCodeRef = useRef<HTMLParagraphElement>(null);

  const beginDeliveryAddressEdit = () => {
    setDeliveryAddressEditing(true);
    setSaveStatus((current) => current === 'error' ? 'idle' : current);
  };

  const endDeliveryAddressEdit = () => {
    setDeliveryAddressEditing(false);
  };

  const lookupDeliveryCep = async () => {
    if (!draft || draft.deliveryPostalCode.replace(/\D/g, '').length !== 8) return;
    setDeliveryCepLoading(true);
    try {
      const result = await lookupPublicDeliveryCep(draft.deliveryPostalCode);
      if (result.address) {
        setDraft((current) => current ? {
          ...current,
          deliveryStreet: result.address!.street,
          deliveryNeighborhood: result.address!.neighborhood,
          deliveryCity: result.address!.city,
          deliveryState: result.address!.state,
          deliveryAddress: composeDeliveryAddress({
            ...current,
            deliveryStreet: result.address!.street,
            deliveryNeighborhood: result.address!.neighborhood,
            deliveryCity: result.address!.city,
            deliveryState: result.address!.state,
          }),
        } : current);
      }
    } catch {
      toast.error('Não foi possível localizar este CEP. Confira os números e tente novamente.');
    } finally {
      setDeliveryCepLoading(false);
    }
  };

  const load = async (mode: 'initial' | 'refresh' = 'initial') => {
    const requestId = ++loadRequestRef.current;
    try {
      setError(null);
      if (mode === 'initial') setLoading(true);
      else setRefreshing(true);
      const next = await getPublicCart(token);
      if (requestId !== loadRequestRef.current) return;
      if (mode === 'refresh') revalidationToastShownRef.current = '';
      setPayload(next);
      const fresh = buildDraftFromPayload(next);
      const slug = typeof next.session.metadata.slug === 'string' ? next.session.metadata.slug : null;
      const hasConsent = slug ? hasZeloMenuCustomerCacheConsent(slug) : false;
      const cached = slug && hasConsent ? loadZeloMenuCustomerCache(slug) : null;
      setRememberCustomerData(hasConsent);
      setDraft((prev) => {
        if (cached) {
          if (
            fresh.fulfillmentType === 'delivery'
            && !fresh.deliveryPostalCode
            && cached.deliveryPostalCode
            && cached.deliveryNumber
          ) {
            customerCacheHydratedRef.current = true;
          }
          return {
            ...fresh,
            customerName: fresh.customerName || cached.name,
            customerPhone: fresh.customerPhone || cached.phone,
            deliveryAddress: fresh.deliveryAddress || cached.deliveryAddress,
            deliveryNeighborhood: fresh.deliveryNeighborhood || cached.deliveryNeighborhood,
            deliveryPostalCode: fresh.deliveryPostalCode || cached.deliveryPostalCode || '',
            deliveryNumber: fresh.deliveryNumber || cached.deliveryNumber || '',
            deliveryComplement: fresh.deliveryComplement || cached.deliveryComplement || '',
            deliveryStreet: fresh.deliveryStreet || cached.deliveryStreet || '',
            deliveryCity: fresh.deliveryCity || cached.deliveryCity || '',
            deliveryState: fresh.deliveryState || cached.deliveryState || '',
          };
        }
        return prev ?? fresh;
      });
      setScheduleMode(deriveScheduleMode(next));
      document.title = next.business.name ? `${next.business.name} | Revisar pedido` : 'Revisar pedido';
    } catch (err) {
      if (requestId !== loadRequestRef.current) return;
      const message = err instanceof Error ? err.message : 'Não consegui carregar o carrinho.';
      if (mode === 'initial' || !payload) {
        setError(message);
      } else {
        toast.error(message);
      }
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    autosaveReadyRef.current = false;
    customerCacheHydratedRef.current = false;
    latestAutosaveRef.current = null;
    saveVersionRef.current += 1;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    setPayload(null);
    setDraft(null);
    setSaveStatus('idle');
    setDeliveryAddressEditing(false);
    void load();
    return () => {
      loadRequestRef.current += 1;
      saveVersionRef.current += 1;
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      document.title = 'ZeloMenu';
    };
  }, [token]);

  const estimated = useMemo(() => {
    if (!payload || !draft) return null;
    return estimateDraftTotals(draft, payload.catalog, payload.session.fulfillment);
  }, [payload, draft]);

  const confirmedProductsById = useMemo(
    () => (payload ? catalogProductMap(payload.catalog) : new Map<number, ZeloMenuCatalogProduct>()),
    [payload],
  );

  const isStale = payload?.link.tokenStatus === 'stale';
  const isOpen = payload?.session.state === 'cart_open';
  const isPublicOrder = payload?.session.context === 'public_order';
  const isTableOrder = payload?.session.context === 'table_order';
  const isConfirmed = payload?.session.state === 'confirmed_waiting_review' || payload?.session.state === 'confirmed_waiting_payment';
  const isWaitingPayment = payload?.session.state === 'confirmed_waiting_payment';
  const pixReceiptRequired = payload?.session.payment.pixReceiptRequired === true;
  const orderStatus = normalizePublicOrderStatus(payload?.order?.status ?? (isWaitingPayment ? 'pending_payment' : 'pending_review'));

  // ── Auto-switch to scheduled mode when store is closed but scheduling is on ──
  useEffect(() => {
    const bh = payload?.business?.businessHours;
    if (!bh || !isOpen || isConfirmed) return;
    if (scheduleMode === 'asap' && bh.configured === true && bh.openNow === false && bh.schedulingEnabled === true) {
      const canSchedule = bh.nextOpen || (Array.isArray(bh.todayWindows) && bh.todayWindows.length > 0);
      if (canSchedule) {
        setScheduleMode('scheduled');
      }
    }
  }, [payload?.business?.businessHours, isOpen, isConfirmed]);

  const paymentSelection = draft?.paymentMethod && isKnownPaymentMethod(draft.paymentMethod)
    ? draft.paymentMethod
    : draft?.paymentMethod
      ? 'Outro'
      : '';
  const revalidationIssues = payload?.revalidation.issues ?? [];
  const revalidationIssueSignature = revalidationSignature(revalidationIssues);
  const applyRevalidationPreview = useCallback(() => {
    if (!payload?.revalidation.previewCart) {
      void load('refresh');
      return;
    }
    const refreshedDraft = buildDraftFromPayload(payload, payload.revalidation.previewCart);
    setDraft((current) => current ? {
      ...current,
      items: refreshedDraft.items,
      observations: refreshedDraft.observations,
    } : refreshedDraft);
    setQuantityDrafts({});
    setStep(0);
    toast.info('Atualizamos os itens e valores do carrinho. Confira antes de confirmar.');
  }, [payload, toast]);
  const effectivePickupDate = scheduleMode === 'asap' ? todayISOdate() : (draft?.pickupDate ?? '');
  const effectivePickupTime = scheduleMode === 'asap' ? nowTimeBR() : (draft?.pickupTime ?? '');
  const detailErrors = draft && isPublicOrder
    ? validateZeloMenuCheckoutDetails({
      customerName: draft.customerName,
      customerPhone: draft.customerPhone,
      fulfillmentType: draft.fulfillmentType,
      deliveryAddress: draft.deliveryAddress,
      pickupDate: effectivePickupDate,
      pickupTime: effectivePickupTime,
    })
    : {};

  const validateDetails = (): string | null => firstZeloMenuCheckoutError(detailErrors);

  // ── Earliest eligible pickup, recomputed on business hours change ───────
  const earliestPickup = useMemo(() => {
    const bh = payload?.business?.businessHours;
    if (!bh || !bh.configured) return null;
    const tz = bh.timezone || 'America/Sao_Paulo';
    return resolveEarliestPickup(
      bh.weeklySchedule,
      { enabled: bh.schedulingEnabled, leadTimeMinutes: bh.schedulingLeadTimeMinutes },
      tz,
      new Date(),
    );
  }, [payload?.business?.businessHours]);

  // ── Available hour/minute slots for the selected date ──────────────────
  const availableSlots = useMemo(() => {
    if (scheduleMode !== 'scheduled' || !draft?.pickupDate) return null;
    const bh = payload?.business?.businessHours;
    const lbl = businessDayLabel(draft.pickupDate);
    if (!bh || !lbl) return null;
    const map: Record<string, DayKey> = { Dom: 'sun', Seg: 'mon', Ter: 'tue', Qua: 'wed', Qui: 'thu', Sex: 'fri', Sáb: 'sat' };
    const dayKey = map[lbl];
    if (!dayKey) return null;
    let mm = 0;
    if (earliestPickup && draft.pickupDate === earliestPickup.date) {
      const p = parseBusinessTime(earliestPickup.time);
      if (p !== null) mm = p;
    }
    return availablePickupSlots(bh.weeklySchedule, dayKey, mm);
  }, [scheduleMode, draft?.pickupDate, payload?.business?.businessHours, earliestPickup]);

  const deliveryQuoteState = resolveDeliveryQuoteUiState(draft, payload, saveStatus === 'error');
  const deliveryQuoteModalOpen = deliveryQuoteState === 'calculating' && saveStatus === 'saving';
  const deliveryQuoteReady = !draft || draft.fulfillmentType !== 'delivery' || deliveryQuoteState === 'ready';
  const canConfirm = isOpen
    && !isStale
    && (draft?.items.length ?? 0) > 0
    && deliveryQuoteReady;

  const autosavePayload = useMemo(
    () => draft && payload ? buildCartUpdatePayload(draft, scheduleMode, payload.session.revision) : null,
    [draft, scheduleMode, payload?.session.revision],
  );
  const autosaveSignature = useMemo(() => {
    if (!autosavePayload) return '';
    const { expectedRevision: _, ...content } = autosavePayload;
    return JSON.stringify(content);
  }, [autosavePayload]);

  const enqueueAutosave = useCallback((nextPayload: ZeloMenuUpdateCartPayload): Promise<AutosaveResult> => {
    const version = ++saveVersionRef.current;
    setSaveStatus('saving');
    const queued = saveQueueRef.current
      .catch(() => null)
      .then(async (previous) => {
        const requestPayload = previous
          ? { ...nextPayload, expectedRevision: previous.session.revision }
          : nextPayload;
        const updated = await updatePublicCart(token, requestPayload);
        syncStoreCacheFromResponse(updated);
        if (version !== saveVersionRef.current) return updated;
        setPayload(updated);
        setSaveStatus('saved');
        return updated;
      })
      .catch(async (error) => {
        if (version !== saveVersionRef.current) return null;
        setSaveStatus('error');
        if (error instanceof ZeloMenuApiError && error.code === 'REVISION_CONFLICT') {
          toast.error(error.detail || 'O carrinho mudou em outra aba. Revise os dados atualizados.');
          await load('refresh');
        }
        return null;
      });
    saveQueueRef.current = queued;
    return queued;
  }, [token, toast]);

  const flushPendingAutosave = useCallback((): Promise<AutosaveResult> => {
    const latest = latestAutosaveRef.current;
    if (latest && autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
      return enqueueAutosave(latest);
    }
    return saveQueueRef.current.catch(() => null);
  }, [enqueueAutosave]);

  useEffect(() => {
    latestAutosaveRef.current = autosavePayload;
  }, [autosavePayload]);

  useEffect(() => {
    if (!autosavePayload || !isOpen || isStale || deliveryAddressEditing || deliveryCepLoading) return;
    if (!autosaveReadyRef.current) {
      autosaveReadyRef.current = true;
      if (!customerCacheHydratedRef.current) return;
      customerCacheHydratedRef.current = false;
    }

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    const deliveryPostalCode = autosavePayload.fulfillment?.deliveryPostalCode?.replace(/\D/g, '') ?? '';
    const deliveryNumber = autosavePayload.fulfillment?.deliveryNumber?.trim() ?? '';
    const isReadyToRequestDeliveryQuote = autosavePayload.fulfillment?.type === 'delivery'
      && deliveryPostalCode.length === 8
      && deliveryNumber.length > 0;
    const debounceMs = isReadyToRequestDeliveryQuote
      ? DELIVERY_QUOTE_DEBOUNCE_MS
      : AUTOSAVE_DEBOUNCE_MS;
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      const latest = latestAutosaveRef.current;
      if (latest) void enqueueAutosave(latest);
    }, debounceMs);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [autosaveSignature, deliveryAddressEditing, deliveryCepLoading, enqueueAutosave, isOpen, isStale]);

  useEffect(() => {
    const flushAutosave = () => {
      if (document.visibilityState !== 'hidden') return;
      void flushPendingAutosave();
    };
    document.addEventListener('visibilitychange', flushAutosave);
    return () => document.removeEventListener('visibilitychange', flushAutosave);
  }, [flushPendingAutosave]);

  useEffect(() => {
    if (!revalidationIssueSignature) {
      revalidationToastShownRef.current = '';
      return;
    }
    if (revalidationToastShownRef.current === revalidationIssueSignature) return;
    const message = buildRevalidationToastMessage(revalidationIssues);
    if (!message) return;
    revalidationToastShownRef.current = revalidationIssueSignature;
    toast.error(message);
  }, [revalidationIssueSignature, revalidationIssues, toast]);

  useEffect(() => {
    if (!isConfirmed) return;
    const refreshStatus = () => {
      if (document.visibilityState === 'visible') void load('refresh');
    };
    const timer = window.setInterval(refreshStatus, 30_000);
    document.addEventListener('visibilitychange', refreshStatus);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshStatus);
    };
  }, [isConfirmed, isTableOrder, token]);

  const confirmCart = async () => {
    if (!draft || !payload || !isOpen || isStale) return;
    if (draft.fulfillmentType === 'delivery' && !deliveryQuoteReady) {
      setStep(1);
      toast.info(
        deliveryQuoteState === 'out_of_area'
          ? 'Este endereço está fora da área de entrega.'
          : 'Aguarde a confirmação da taxa de entrega antes de finalizar o pedido.',
      );
      return;
    }
    if (payload.session.context !== 'table_order') {
      const validationError = validateDetails();
      if (validationError) {
        setShowErrors(true);
        setStep(1);
        toast.error(validationError);
        return;
      }
    }
    try {
      setConfirming(true);
      setError(null);
      const flushed = await flushPendingAutosave();
      const latestPayload = flushed ?? payload;
      const updated = await updatePublicCart(token, buildCartUpdatePayload(draft, scheduleMode, latestPayload.session.revision));
      syncStoreCacheFromResponse(updated);

      const updateIssues = updated.revalidation.issues ?? [];
      if (updateIssues.length > 0) {
        const signature = revalidationSignature(updateIssues);
        revalidationToastShownRef.current = signature;
        setPayload(updated);
        setDraft(buildDraftFromPayload(updated));
        setScheduleMode(deriveScheduleMode(updated));
        const updateMessage = buildRevalidationToastMessage(updateIssues);
        if (updateMessage) toast.error(updateMessage);
        return;
      }

      const next = await confirmPublicCart(token, updated.session.revision, crypto.randomUUID());
      syncStoreCacheFromResponse(next);
      const finalIssues = next.revalidation.issues ?? [];
      if (!next.confirmation.confirmed && finalIssues.length > 0) {
        const signature = revalidationSignature(finalIssues);
        revalidationToastShownRef.current = signature;
        const finalMessage = buildRevalidationToastMessage(finalIssues);
        if (finalMessage) toast.error(finalMessage);
      }
      setPayload(next);
      setDraft(buildDraftFromPayload(next));
      setScheduleMode(deriveScheduleMode(next));
      // Autofill: salva dados do cliente no cache local após confirmação
      if (next.confirmation.confirmed && isPublicOrder) {
        const slug = typeof next.session.metadata.slug === 'string' ? next.session.metadata.slug : null;
        if (slug && rememberCustomerData && (draft.customerName || draft.customerPhone)) {
          setZeloMenuCustomerCacheConsent(slug, true);
          saveZeloMenuCustomerCache(slug, {
            name: draft.customerName,
            phone: normalizePhoneNumber(draft.customerPhone).slice(0, 11),
            deliveryAddress: draft.deliveryAddress,
            deliveryNeighborhood: draft.deliveryNeighborhood,
            deliveryPostalCode: draft.deliveryPostalCode,
            deliveryNumber: draft.deliveryNumber,
            deliveryComplement: draft.deliveryComplement,
            deliveryStreet: draft.deliveryStreet,
            deliveryCity: draft.deliveryCity,
            deliveryState: draft.deliveryState,
          });
        } else if (slug && !rememberCustomerData) {
          clearZeloMenuCustomerCache(slug);
        }
      }
      if (next.confirmation.confirmed) {
        toast.success(
          next.confirmation.alreadyConfirmed
            ? 'Este pedido já estava confirmado.'
            : payload.session.context === 'table_order'
              ? 'Pedido enviado! Aguarde o garçom.'
              : 'Pedido confirmado! A loja recebeu o pedido.',
        );
      } else if (finalIssues.length > 0) {
        // Toast específico já foi exibido acima.
      } else {
        toast.info('Revise os avisos do carrinho antes de confirmar.');
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : '';
      if (err instanceof ZeloMenuApiError && err.code === 'REVISION_CONFLICT') {
        toast.error(err.detail || 'O carrinho foi atualizado. Revise os dados antes de confirmar.');
        await load('refresh');
      } else if (err instanceof ZeloMenuApiError && err.code === 'DELIVERY_FEE_CHANGED') {
        toast.error('O valor do frete mudou. Revise o novo valor e confirme novamente.');
        await load('refresh');
      } else if (err instanceof ZeloMenuApiError && err.code === 'REQUEST_TIMEOUT') {
        toast.error('A conexão demorou demais. Verifique a internet e tente confirmar novamente.');
      } else if (errMessage === 'TABLE_TAKEN_BY_OTHER_GROUP') {
        toast.error('Esta mesa está sendo atendida por outro grupo. Escaneie o QR novamente.');
      } else if (errMessage === 'COMANDA_CLOSED') {
        toast.error('Sessão encerrada. Peça ao garçom para abrir uma nova comanda.');
      } else if (errMessage.startsWith('STORE_CLOSED_ASAP:')) {
        // Show just the user-friendly part after the prefix
        toast.error(errMessage.slice('STORE_CLOSED_ASAP:'.length));
      } else if (errMessage.startsWith('PICKUP_OUTSIDE_HOURS:')) {
        toast.error(errMessage.slice('PICKUP_OUTSIDE_HOURS:'.length));
      } else if (errMessage.startsWith('PICKUP_CLOSED_DAY:')) {
        toast.error(errMessage.slice('PICKUP_CLOSED_DAY:'.length));
      } else if (errMessage === 'ORDER_MATERIALIZATION_FAILED') {
        toast.error('Erro ao registrar o pedido. Tente novamente.');
      } else if (errMessage.startsWith('PICKUP_TIME_INVALID:')) {
        toast.error(errMessage.slice('PICKUP_TIME_INVALID:'.length));
      } else if (errMessage.startsWith('PICKUP_IN_PAST:')) {
        toast.error(errMessage.slice('PICKUP_IN_PAST:'.length));
      } else if (errMessage.startsWith('INTERNAL_ERROR:')) {
        toast.error(errMessage.slice('INTERNAL_ERROR:'.length));
      } else if (errMessage === 'INTERNAL_ERROR') {
        toast.error('Ocorreu um erro inesperado. Tente novamente mais tarde.');
      } else {
        toast.error('Não consegui confirmar o pedido. Tente novamente.');
      }
    } finally {
      setConfirming(false);
    }
  };

  const changeItemQuantity = (itemKey: string, nextQuantity: number) => {
    if (!isOpen) return;
    setQuantityDrafts((current) => {
      if (!(itemKey in current)) return current;
      const { [itemKey]: _removed, ...rest } = current;
      return rest;
    });
    setDraft((current) => {
      if (!current) return current;
      const normalizedQuantity = Math.max(0, Math.floor(nextQuantity));
      const existing = current.items.find((item) => draftItemKey(item) === itemKey);
      if (!existing && normalizedQuantity === 0) return current;
      const items = existing
        ? current.items
          .map((item) => draftItemKey(item) === itemKey ? { ...item, quantity: normalizedQuantity } : item)
          .filter((item) => item.quantity > 0)
        : current.items;
      return { ...current, items };
    });
  };

  const clearItems = () => {
    setDraft((current) => current ? { ...current, items: [] } : current);
    setQuantityDrafts({});
  };

  const editItemQuantity = (itemKey: string, rawValue: string) => {
    if (!isOpen) return;
    const digits = rawValue.replace(/\D/g, '').slice(0, 4);
    setQuantityDrafts((current) => ({ ...current, [itemKey]: digits }));
    if (!digits) return;
    const quantity = Number.parseInt(digits, 10);
    if (quantity >= 1) {
      setDraft((current) => current ? {
        ...current,
        items: current.items.map((item) =>
          draftItemKey(item) === itemKey ? { ...item, quantity } : item),
      } : current);
    }
  };

  const finishEditingItemQuantity = (itemKey: string) => {
    setQuantityDrafts((current) => {
      if (!(itemKey in current)) return current;
      const { [itemKey]: _removed, ...rest } = current;
      return rest;
    });
  };

  const updateField = <K extends keyof DraftState>(key: K, value: DraftState[K]) => {
    if (!isOpen) return;
    setDraft((current) => {
      if (!current) return current;
      const next = {
        ...current,
        [key]: key === 'customerPhone'
          ? maskBrazilianPhone(String(value ?? '')) as DraftState[K]
          : value,
      } as DraftState;
      if (key === 'deliveryStreet' || key === 'deliveryNumber' || key === 'deliveryComplement'
        || key === 'deliveryNeighborhood' || key === 'deliveryCity' || key === 'deliveryState') {
        next.deliveryAddress = composeDeliveryAddress(next);
      }
      return next;
    });
  };

  const goNext = () => {
    if (isTableOrder) {
      void confirmCart();
      return;
    }
    if (step === 1) {
      if (draft?.fulfillmentType === 'delivery' && !deliveryQuoteReady) {
        toast.info(
          deliveryQuoteState === 'out_of_area'
            ? 'Este endereço está fora da área de entrega.'
            : 'Aguarde a confirmação da taxa de entrega antes de continuar.',
        );
        return;
      }
      const validationError = validateDetails();
      if (validationError) {
        setShowErrors(true);
        toast.error(validationError);
        return;
      }
    }
    if (step < 2) {
      setShowErrors(false);
      setStep((s) => Math.min(2, s + 1));
    } else {
      void confirmCart();
    }
  };

  const goBack = async () => {
    if (step > 0) setStep((s) => Math.max(0, s - 1));
    else {
      await flushPendingAutosave();
      window.history.back();
    }
  };

  const enableAsap = () => {
    setScheduleMode('asap');
    updateField('pickupTime', nowTimeBR());
    updateField('pickupDate', todayISOdate());
  };

  const enableScheduled = () => {
    if (scheduleMode === 'asap') {
      // Set first eligible date/time based on business hours
      const bh = payload?.business?.businessHours;
      if (bh && bh.configured) {
        const tz = bh.timezone || 'America/Sao_Paulo';
        const earliest = resolveEarliestPickup(
          bh.weeklySchedule,
          { enabled: bh.schedulingEnabled, leadTimeMinutes: bh.schedulingLeadTimeMinutes },
          tz,
          new Date(),
        );
        updateField('pickupDate', earliest.date);
        updateField('pickupTime', earliest.time);
      } else {
        updateField('pickupDate', '');
        updateField('pickupTime', '');
      }
    }
    setScheduleMode('scheduled');
  };

  const paymentIcon = (opt: string) => {
    if (opt === 'Pix') return <QrCode className="h-4 w-4" strokeWidth={1.8} />;
    if (opt === 'Dinheiro') return <Banknote className="h-4 w-4" strokeWidth={1.8} />;
    if (opt.startsWith('Cartão')) return <CreditCard className="h-4 w-4" strokeWidth={1.8} />;
    return <Wallet className="h-4 w-4" strokeWidth={1.8} />;
  };

  const copyPixCode = async (code: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard indisponível');
      await navigator.clipboard.writeText(code);
      toast.success('Código Pix copiado!');
    } catch {
      // Fallback: seleciona o texto para o cliente copiar manualmente
      // (clipboard API pode estar indisponível em contexto não-seguro/navegador antigo).
      const el = pixCodeRef.current;
      const selection = window.getSelection?.();
      if (el && selection) {
        const range = document.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
        toast.info('Não consegui copiar automaticamente. O código já está selecionado — copie manualmente.');
      } else {
        toast.error('Não consegui copiar o código Pix.');
      }
    }
  };

  if (loading) {
    return (
      <div className="zelomenu-theme min-h-screen bg-[var(--zm-canvas)] text-[var(--zm-ink)]">
        <div className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--zm-brand)]" strokeWidth={1.8} />
          <p className="mt-4 text-[14px] text-[var(--zm-ink-soft)]">Carregando seu carrinho…</p>
        </div>
      </div>
    );
  }

  if (error && !payload) {
    return (
      <div className="zelomenu-theme min-h-screen bg-[var(--zm-canvas)] text-[var(--zm-ink)]">
        <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
          <div className="rounded-full bg-[var(--color-alert-soft)] p-4 text-[var(--color-alert)]">
            <AlertTriangle className="h-8 w-8" strokeWidth={1.8} />
          </div>
          <h1 className="mt-5 text-[22px] font-semibold">Não consegui abrir este carrinho</h1>
          <p className="mt-2 max-w-xl text-[14px] text-[var(--zm-ink-soft)]">{error}</p>
          <button
            type="button"
            onClick={() => void load('initial')}
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg bg-[var(--zm-brand)] px-4 text-[14px] font-medium text-white"
          >
            <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  if (!payload || !draft || !estimated) return null;

  const STEP_TITLES = ['Sua sacola', 'Entrega ou retirada', 'Revisar e confirmar'] as const;
  const isDelivery = draft.fulfillmentType === 'delivery';
  const deliveryEnabled = payload.business.deliveryEnabled;
  const deliveryEstimateLabel = isDelivery
    ? formatEstimatedDeliveryMinutes(payload.business.deliveryEstimatedMinutes)
    : null;
  const fee = estimated.deliveryFee;
  const feeToConfirm = estimated.deliveryFeeToConfirm;
  const stepLabel1 = isDelivery ? 'Entrega' : 'Retirada';
  const itemCount = estimated.items.reduce((sum, item) => sum + item.quantity, 0);

  const footPricing = (isTableOrder || step === 0) ? estimated.subtotal
    : feeToConfirm ? estimated.subtotal
    : payload.session.pricing.discount > 0 ? payload.session.pricing.total
    : estimated.total;
  const footValue = feeToConfirm ? `${toBRL(footPricing)} + entrega` : toBRL(footPricing);

  const liveDiscount = payload.session.pricing.discount || 0;
  let footSub = '';
  if (!isTableOrder && step > 0) {
    const parts: string[] = [];
    if (!isDelivery) parts.push('Retirada · sem taxa');
    else if (deliveryQuoteState === 'calculating') parts.push('calculando entrega…');
    else if (deliveryQuoteState === 'out_of_area') parts.push('endereço fora da área');
    else if (deliveryQuoteState === 'unavailable') parts.push('taxa indisponível');
    else if (fee === 0) parts.push('Entrega grátis');
    else parts.push(`inclui ${toBRL(fee)} de entrega`);
    if (liveDiscount > 0) parts.push(`-${toBRL(liveDiscount)} de desconto`);
    footSub = parts.join('\u00A0·\u00A0');
  }

  // Context-aware CTA labels based on step and store state
  const bh = payload?.business?.businessHours;
  const storeClosedWithSchedule = bh?.configured && !bh.openNow && (bh.nextOpen || (Array.isArray(bh.todayWindows) && bh.todayWindows.length > 0));
  const ctaLabel = isTableOrder
    ? (confirming ? 'Enviando…' : 'Enviar pedido')
    : step === 0
      ? (storeClosedWithSchedule ? 'Agendar retirada' : 'Escolher retirada')
      : step === 1
        ? deliveryQuoteState === 'missing_address'
          ? 'Informe o endereço'
          : deliveryQuoteState === 'calculating'
          ? 'Calculando entrega…'
          : deliveryQuoteState === 'out_of_area'
            ? 'Endereço fora da área'
            : deliveryQuoteState === 'unavailable'
              ? 'Aguardando taxa'
              : 'Revisar pedido'
        : confirming ? 'Confirmando…' : 'Confirmar pedido';
  const ctaDisabled = isTableOrder
    ? (draft.items.length === 0 || confirming || !deliveryQuoteReady)
    : step === 0 ? draft.items.length === 0 : step === 1 ? !deliveryQuoteReady : (!canConfirm || confirming);

  const prettyDate = effectivePickupDate ? effectivePickupDate.split('-').reverse().join('/') : '';
  const whenLabel = scheduleMode === 'asap'
    ? 'o quanto antes'
    : [prettyDate || null, effectivePickupTime || null].filter(Boolean).join(' às ') || 'a combinar';
  const summaryMeta = `${isDelivery ? 'Entrega' : 'Retirada'} · ${whenLabel}${isDelivery && draft.deliveryNeighborhood ? ` · ${draft.deliveryNeighborhood}` : ''}`;

  const inputCls = 'h-11 w-full rounded-lg border border-[var(--zm-line)] bg-[var(--zm-surface)] px-3 text-[14px] text-[var(--zm-ink)] outline-none transition-colors focus:border-[var(--zm-brand)]';
  const invalidInputCls = 'border-[var(--color-alert)] focus:border-[var(--color-alert)]';
  const labelCls = 'text-[11.5px] font-semibold text-[var(--zm-ink-soft)]';
  const requiredMark = <span className="text-[var(--color-alert)]" aria-hidden="true">*</span>;
  const fieldError = (message: string | undefined) => showErrors && message
    ? <span role="alert" className="text-[11px] text-[var(--color-alert)]">{message}</span>
    : null;
  const segCls = (active: boolean) =>
    `flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'bg-[var(--zm-surface)] text-[var(--zm-ink)] shadow-sm' : 'text-[var(--zm-ink-soft)]'}`;
  const iconBtnCls = 'flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[var(--zm-surface-muted)] text-[var(--zm-ink)] transition active:scale-90';

  return (
    <div className="zelomenu-theme flex min-h-[100dvh] justify-center bg-[var(--zm-canvas)] text-[var(--zm-ink)]">
      <div className="flex h-[100dvh] w-full max-w-[480px] flex-col overflow-hidden bg-[var(--zm-canvas)] sm:my-6 sm:h-[min(780px,92dvh)] sm:min-h-0 sm:overflow-hidden sm:rounded-[28px] sm:border sm:border-[var(--zm-line)] sm:bg-[var(--zm-surface)] sm:shadow-[0_30px_70px_-30px_rgba(16,20,24,0.35)]">
        {isConfirmed ? (
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <figure className="w-full" style={{ aspectRatio: '941 / 472' }}>
                <img
                  src="/zelomenu-pedido-enviado-hero.webp"
                  alt="ZeloMenu acompanhando o seu pedido"
                  width={941}
                  height={472}
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </figure>

              <div className="relative z-[1] -mt-[18px] rounded-t-[26px] bg-[var(--zm-surface)] px-5 pb-8 pt-7">
                {(() => {
                  const isTerminalBad = orderStatus === 'rejected' || orderStatus === 'cancelled';
                  const { title, description } = resolveConfirmedStatusCopy(orderStatus, isDelivery, isTableOrder);
                  const nextStepText = resolveConfirmedNextStep(orderStatus, isDelivery, isTableOrder);
                  const orderInfo = resolveOrderStatus(orderStatus, isDelivery);
                  const slug = payload?.session?.metadata?.slug;
                  const storeSlug = typeof slug === 'string' ? slug : null;
                  const whatsapp = payload?.business.whatsapp ?? null;
                  const whatsappHref = !isTableOrder && !isTerminalBad && isPublicOrder && whatsapp
                    ? buildWhatsAppOrderLink(
                        whatsapp,
                        buildWhatsAppOrderMessage({
                          orderId: payload?.session.orderingId ?? '',
                          customerName: draft.customerName || null,
                          customerPhone: draft.customerPhone || null,
                          items: estimated.items.map((item) => ({
                            name: formatModifierAwareCartItem(item),
                            quantity: item.quantity,
                            lineTotal: item.lineTotal,
                          })),
                          subtotal: payload.session.pricing.subtotal,
                          total: payload.session.pricing.total,
                          deliveryFee: payload.session.pricing.deliveryFee,
                          feeToConfirm: payload.session.fulfillment.deliveryFeeToConfirm,
                          discount: payload.session.pricing.discount,
                          couponCode: payload.session.pricing.couponCode,
                          paymentMethod: draft.paymentMethod || null,
                          isDelivery,
                          whenLabel,
                          deliveryAddress: isDelivery ? (draft.deliveryAddress || null) : null,
                          deliveryNeighborhood: isDelivery ? (draft.deliveryNeighborhood || null) : null,
                          observations: draft.observations || null,
                        }),
                      )
                    : null;
                  const pickupDescription = isDelivery
                    ? [draft.deliveryAddress, draft.deliveryNeighborhood].filter(Boolean).join(', ') || whenLabel
                    : (whenLabel === 'o quanto antes' ? 'Assim que ficar pronto' : whenLabel);

                  // Pagamento-first: quando há Pix a pagar, o código sobe pro topo
                  // (logo após o título) e a timeline de status desce — padrão de
                  // checkout das big techs. Sem Pix, status fica no topo.
                  const hasPix = !isTableOrder
                    && orderStatus !== 'rejected'
                    && orderStatus !== 'cancelled'
                    && !!payload.session.payment.pixCopyPaste;

                  const timelineEl = isTerminalBad ? null : (
                    <ol className="mt-6" aria-label="Andamento do pedido">
                      {orderInfo.steps.map((step, i) => {
                        const isCompleted = i < orderInfo.currentStepIndex;
                        const isActive = i === orderInfo.currentStepIndex;
                        const isDone = isCompleted || isActive;
                        const isLast = i === orderInfo.steps.length - 1;
                        return (
                          <li key={step.key} className={`relative flex gap-3.5 ${isLast ? '' : 'pb-6'}`}>
                            {!isLast && (
                              <span
                                aria-hidden="true"
                                className={`absolute bottom-0 left-[11px] top-6 w-0.5 ${isCompleted ? 'bg-[var(--zm-brand)]' : 'bg-[var(--zm-line-strong)]'}`}
                              />
                            )}
                            <span className={`relative z-[1] flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 ${
                              isDone
                                ? 'border-[var(--zm-brand)] bg-[var(--zm-brand)]'
                                : 'border-[var(--zm-line-strong)] bg-[var(--zm-surface)]'
                            }`}>
                              {isDone && <CheckCircle2 className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                            </span>
                            <div className="flex flex-1 items-center justify-between gap-2">
                              <span className={`text-[13.5px] ${
                                isActive
                                  ? 'font-semibold text-[var(--zm-ink)]'
                                  : isCompleted
                                    ? 'font-medium text-[var(--zm-ink)]'
                                    : 'text-[var(--zm-ink-soft)]'
                              }`}>
                                {step.label}
                              </span>
                              {isActive && (
                                <span className="flex-none rounded-full bg-[var(--zm-brand-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--zm-brand-deep)]">
                                  Agora
                                </span>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  );

                  return (
                    <>
                      <header className="text-center">
                        <h2 className="text-[21px] font-semibold leading-tight tracking-tight">{title}</h2>
                        <p className="mx-auto mt-2 max-w-[320px] text-[13.5px] leading-relaxed text-[var(--zm-ink-soft)]">
                          {description}
                        </p>
                      </header>

                      {!isTerminalBad && !isTableOrder && payload.order && (
                        <PushNotificationButton variant="order" orderId={resolvePublicPushOrderId(payload.order)} cartToken={token} />
                      )}

                      {hasPix && (
                        <div className="mt-5 rounded-2xl border border-[var(--zm-line)] bg-[var(--zm-surface)] p-4">
                          <div className="flex items-center gap-1.5 text-[var(--zm-brand-deep)]">
                            <QrCode className="h-4 w-4" strokeWidth={1.8} />
                            <p className="text-[12.5px] font-semibold">Pix Copia e Cola</p>
                          </div>
                          <p className="mt-2 text-[22px] font-bold tabular-nums text-[var(--zm-ink)]">
                            {toBRL(payload.session.pricing.total)}
                          </p>
                          <p
                            ref={pixCodeRef}
                            className="mt-2 max-h-24 overflow-y-auto break-all rounded-lg bg-[var(--zm-surface-muted)] p-2.5 font-mono text-[11px] leading-snug text-[var(--zm-ink-soft)]"
                          >
                            {payload.session.payment.pixCopyPaste}
                          </p>
                          <button
                            type="button"
                            onClick={() => void copyPixCode(payload.session.payment.pixCopyPaste as string)}
                            className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--zm-brand)] text-[13.5px] font-semibold text-white transition-opacity hover:opacity-90 active:scale-95"
                          >
                            <Copy className="h-4 w-4" strokeWidth={2} />
                            Copiar código Pix
                          </button>
                          <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--zm-ink-soft)]">
                            Cole no app do seu banco e pague. {pixReceiptRequired ? 'Se a loja solicitar, envie o comprovante no WhatsApp.' : 'O andamento será atualizado nesta tela.'}
                          </p>
                        </div>
                      )}

                      {isWaitingPayment && pixReceiptRequired && !hasPix ? (
                        <div role="alert" className="mt-5 flex items-start gap-2.5 rounded-2xl border border-[var(--color-alert-soft)] bg-[var(--color-alert-soft)] p-4 text-[12px] leading-relaxed text-[var(--color-alert)]">
                          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" strokeWidth={1.9} />
                          <span>A loja solicitou um comprovante, mas não há código Pix disponível neste momento. Use o WhatsApp da loja para confirmar o pagamento.</span>
                        </div>
                      ) : null}

                      {!hasPix && timelineEl}

                      {!isTerminalBad && (
                        <section className="mt-1 rounded-2xl border border-[var(--zm-line)] bg-[var(--zm-surface)] p-4 shadow-[0_18px_44px_rgba(38,22,86,0.08)]">
                          <div className="mb-3.5 flex items-center justify-between">
                            <p className="text-[13px] font-bold">Seu pedido</p>
                            <span className="text-[12px] text-[var(--zm-ink-soft)]">
                              {itemCount} {itemCount === 1 ? 'item' : 'itens'}
                            </span>
                          </div>
                          <div className="flex flex-col gap-3">
                            {estimated.items.map((item) => {
                              const key = estimatedItemKey(item);
                              const product = item.productId != null ? confirmedProductsById.get(item.productId) : null;
                              return (
                                <div key={key} className="flex items-center gap-3.5">
                                  <div className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-2xl bg-[var(--zm-brand-soft)] text-[var(--zm-brand)]">
                                    {product?.photoUrl ? (
                                      <img src={product.photoUrl} alt="" className="h-full w-full object-cover" />
                                    ) : (
                                      <UtensilsCrossed className="h-7 w-7" strokeWidth={1.7} aria-hidden="true" />
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="truncate text-[14.5px] font-bold leading-tight">
                                      {formatModifierAwareCartItem(item)}
                                    </p>
                                    <p className="mt-0.5 text-[12.5px] text-[var(--zm-ink-soft)]">
                                      {item.quantity} {item.quantity === 1 ? 'unidade' : 'unidades'}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <div className="mt-4 flex items-center gap-3 border-t border-[var(--zm-line)] pt-4">
                            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-[var(--zm-brand-soft)] text-[var(--zm-brand)]">
                              {isDelivery
                                ? <Bike className="h-[21px] w-[21px]" strokeWidth={1.9} />
                                : <ShoppingBag className="h-[21px] w-[21px]" strokeWidth={1.9} />}
                            </span>
                            <div className="min-w-0">
                              <p className="text-[13px] font-bold">{isDelivery ? 'Entrega' : 'Retirada'}</p>
                              <p className="mt-0.5 truncate text-[12px] text-[var(--zm-ink-soft)]">{pickupDescription}</p>
                            </div>
                          </div>

                          <div className="mt-4 flex items-baseline justify-between border-t border-[var(--zm-line)] pt-4">
                            <span className="text-[14px] font-bold">Total</span>
                            <span className="text-[19px] font-extrabold tabular-nums">
                              {feeToConfirm ? `${toBRL(estimated.subtotal)} + entrega` : toBRL(estimated.total)}
                            </span>
                          </div>
                        </section>
                      )}

                      {hasPix && timelineEl}

                      {!isTerminalBad && nextStepText && (
                        <aside className="mt-4 flex items-center gap-3 rounded-2xl bg-gradient-to-r from-[var(--zm-brand-soft)] to-[var(--zm-surface)] p-4">
                          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[var(--zm-brand)] text-white">
                            <MessageCircle className="h-5 w-5" strokeWidth={1.9} />
                          </span>
                          <div>
                            <p className="text-[13px] font-bold">Próximo passo</p>
                            <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--zm-ink-soft)]">{nextStepText}</p>
                          </div>
                        </aside>
                      )}

                      <div className="mt-5 flex flex-col gap-2.5">
                        {isTerminalBad ? (
                          storeSlug && (
                            <Link
                              to={buildPublicStorePath(storeSlug)}
                              className="inline-flex h-[52px] items-center justify-center rounded-2xl border border-[var(--zm-line-strong)] bg-[var(--zm-surface)] px-6 text-[14px] font-bold text-[var(--zm-brand)] transition-colors hover:bg-[var(--zm-brand-soft)] active:scale-95"
                            >
                              Ver cardápio
                            </Link>
                          )
                        ) : isTableOrder ? (
                          <span className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--zm-brand-soft)] px-4 text-[13px] font-semibold text-[var(--zm-brand-deep)]">
                            <MessageCircle className="h-4 w-4" strokeWidth={2} />
                            Aguarde o garçom
                          </span>
                        ) : (
                          <>
                            {whatsappHref && (
                              <a
                                href={whatsappHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex h-[52px] items-center justify-center gap-2 rounded-2xl bg-[var(--zm-brand)] px-6 text-[14px] font-bold text-white shadow-[0_12px_28px_rgba(110,58,255,0.28)] transition-opacity hover:opacity-90 active:scale-95"
                              >
                                <MessageCircle className="h-[21px] w-[21px]" strokeWidth={1.9} />
                                {isWaitingPayment && pixReceiptRequired ? 'Enviar comprovante no WhatsApp' : 'Conversar com a loja'}
                              </a>
                            )}
                            {storeSlug && (
                              <Link
                                to={buildPublicStorePath(storeSlug)}
                                className="inline-flex h-[52px] items-center justify-center rounded-2xl border border-[var(--zm-line-strong)] bg-[var(--zm-surface)] px-6 text-[14px] font-bold text-[var(--zm-brand)] transition-colors hover:bg-[var(--zm-brand-soft)] active:scale-95"
                              >
                                Ver cardápio
                              </Link>
                            )}
                          </>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col">
            {/* header */}
            <div className="flex-none border-b border-[var(--zm-line)] bg-[var(--zm-canvas)] px-3 pb-3 pt-3 sm:bg-[var(--zm-surface)]">
              <div className="flex items-center gap-2">
                <button type="button" onClick={goBack} aria-label={step === 0 ? 'Fechar' : 'Voltar'} className={iconBtnCls}>
                  {step === 0
                    ? <X className="h-5 w-5" strokeWidth={1.9} />
                    : <ChevronLeft className="h-5 w-5" strokeWidth={1.9} />}
                </button>
                <div className="min-w-0 flex-1 text-center">
                  <p className="truncate text-[15px] font-semibold leading-tight">
                    {isTableOrder ? 'Meu pedido' : STEP_TITLES[step]}
                  </p>
                  <p className="truncate text-[11.5px] text-[var(--zm-ink-soft)]">
                    {payload.business.name}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void flushPendingAutosave().then(() => load('refresh'))}
                  aria-label="Revalidar"
                  className={iconBtnCls}
                >
                  {refreshing
                    ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
                    : <RefreshCw className="h-4 w-4" strokeWidth={1.8} />}
                </button>
              </div>

              {/* stepper — oculto no fluxo de mesa */}
              {!isTableOrder && <div className="mt-3 flex gap-2">
                {[
                  { n: '1', label: 'Sacola' },
                  { n: '2', label: stepLabel1 },
                  { n: '3', label: 'Confirmar' },
                ].map((s, i) => {
                  const status = i < step ? 'done' : i === step ? 'active' : 'todo';
                  return (
                    <div key={s.n} className="min-w-0 flex-1">
                      <div className={`mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold ${
                        status === 'todo'
                          ? 'text-[var(--zm-ink-soft)/50]'
                          : status === 'active'
                            ? 'text-[var(--zm-ink)]'
                            : 'text-[var(--zm-brand-deep)]'
                      }`}>
                        <span className={`flex h-4 w-4 flex-none items-center justify-center rounded-full text-[9px] font-bold text-white ${
                          status === 'active'
                            ? 'bg-[var(--zm-brand)]'
                            : status === 'done'
                              ? 'bg-[var(--zm-brand)]'
                              : 'bg-[var(--zm-line-strong)]'
                        }`}>{s.n}</span>
                        <span className="truncate">{s.label}</span>
                      </div>
                      <div className="h-[3px] overflow-hidden rounded-full bg-[var(--zm-line)]">
                        <div
                          className="h-full rounded-full bg-[var(--zm-brand)] origin-left transition-transform duration-[420ms] ease-out motion-reduce:transition-none"
                          style={{ transform: `scaleX(${status === 'todo' ? 0 : 1})` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>}
            </div>

            {/* link desatualizado */}
            {isStale ? (
              <div className="flex-none border-b border-[var(--color-warn-soft)] bg-[var(--color-warn-soft)] px-4 py-2.5">
                <div className="flex gap-2">
                  <AlertTriangle className="mt-px h-4 w-4 flex-none text-[var(--color-warn)]" strokeWidth={1.8} />
                  <p className="text-[12px] leading-snug text-[var(--zm-ink-soft)]">
                    Este link ficou desatualizado. Você ainda pode revisar, mas para salvar mudanças peça um link novo.
                  </p>
                </div>
              </div>
            ) : null}

            {/* viewport — trilho que desliza entre os passos */}
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <div
                className="flex h-full w-[300%] transition-transform duration-[440ms] ease-[cubic-bezier(.22,.61,.36,1)] motion-reduce:transition-none"
                style={{ transform: isTableOrder ? 'translateX(0)' : `translateX(-${step * (100 / 3)}%)` }}
              >
                {/* PASSO 1 — sacola */}
                <section inert={step !== 0} className="h-full w-1/3 overflow-y-auto">
                  <div className="flex flex-col gap-3.5 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[13px] font-semibold">
                        <ShoppingCart className="h-4 w-4 text-[var(--zm-ink-soft)]" strokeWidth={1.8} />
                        Itens do pedido
                      </div>
                      {draft.items.length > 0 && (
                        <button
                          type="button"
                          onClick={clearItems}
                          className="flex items-center gap-1 text-[12px] text-[var(--zm-ink-soft)] transition-colors hover:text-[var(--color-alert)] active:scale-95"
                          aria-label="Limpar carrinho"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                          Limpar
                        </button>
                      )}
                    </div>
                    {revalidationIssues.length > 0 && !isConfirmed && step > 0 ? (
                      <section
                        role="alert"
                        className="rounded-xl border border-[var(--color-alert-soft)] bg-[var(--color-alert-soft)] p-3 text-[12px] text-[var(--color-alert)]"
                      >
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" strokeWidth={1.9} />
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold">Revise seu carrinho antes de confirmar</p>
                            <ul className="mt-1.5 list-disc space-y-1 pl-4 leading-snug">
                              {revalidationIssues.slice(0, 4).map((issue, index) => (
                                <li key={`${issue.code}-${issue.productName ?? 'cart'}-${index}`}>
                                  {issue.message}
                                  {issue.code === 'price_changed' && issue.previousUnitPrice != null && issue.currentUnitPrice != null
                                    ? ` ${toBRL(issue.previousUnitPrice)} → ${toBRL(issue.currentUnitPrice)}.`
                                    : null}
                                  {issue.code === 'stock_insufficient' && issue.availableQuantity != null
                                    ? ` Disponível: ${issue.availableQuantity}.`
                                    : null}
                                </li>
                              ))}
                            </ul>
                            {revalidationIssues.length > 4 ? (
                              <p className="mt-1">Há mais {revalidationIssues.length - 4} ajuste(s) no carrinho.</p>
                            ) : null}
                            <button
                              type="button"
                              onClick={applyRevalidationPreview}
                              disabled={refreshing}
                              className="mt-2.5 inline-flex min-h-9 items-center justify-center rounded-lg border border-current px-3 font-semibold transition-opacity disabled:opacity-50"
                            >
                              {refreshing ? 'Atualizando…' : payload?.revalidation.previewCart ? 'Atualizar itens e valores' : 'Tentar novamente'}
                            </button>
                          </div>
                        </div>
                      </section>
                    ) : null}
                    {draft.items.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[var(--zm-line)] bg-[var(--zm-surface-muted)] px-4 py-7 text-center">
                        <p className="text-[14px] font-medium text-[var(--zm-ink-soft)]">Seu carrinho está vazio.</p>
                        <p className="mt-1 text-[13px] text-[var(--zm-ink-soft)]">Volte ao cardápio para escolher os itens.</p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2.5">
                        {estimated.items.map((item) => {
                          const key = estimatedItemKey(item);
                          return (
                            <div key={key} className="flex items-center gap-3 rounded-xl border border-[var(--zm-line)] bg-[var(--zm-surface)] p-2.5">
                              <div className="flex min-w-0 flex-1 flex-col">
                                <p className="text-[13.5px] font-semibold leading-tight">{item.productName}</p>
                                {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                                  <div className="mt-1 space-y-0.5">
                                    {item.selectedModifiers.map((group) => (
                                      <p key={group.groupId} className="text-[11.5px] leading-snug text-[var(--zm-ink-soft)]">
                                        {group.groupName}: {group.selectedOptions.map((opt) => opt.quantity > 1 ? `${opt.quantity}x ${opt.optionName}` : opt.optionName).join(', ')}
                                      </p>
                                    ))}
                                  </div>
                                )}
                                <p className="mt-0.5 text-[11.5px] tabular-nums text-[var(--zm-ink-soft)]">{toBRL(item.unitPrice)} cada</p>
                              </div>
                              <div className="inline-flex h-9 flex-none items-center rounded-lg border border-[var(--zm-line)] bg-[var(--zm-surface)]">
                                <button
                                  type="button"
                                  onClick={() => changeItemQuantity(key, item.quantity - 1)}
                                  className={`flex h-9 w-9 items-center justify-center transition-transform active:scale-90 ${item.quantity <= 1 ? 'text-[var(--color-alert)]' : 'text-[var(--zm-ink-soft)]'}`}
                                  aria-label={`Diminuir ${item.productName}`}
                                >
                                  {item.quantity <= 1
                                    ? <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                                    : <Minus className="h-4 w-4" strokeWidth={1.8} />}
                                </button>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  aria-label={`Quantidade de ${item.productName}`}
                                  value={quantityDrafts[key] ?? String(item.quantity)}
                                  onFocus={(event) => event.currentTarget.select()}
                                  onChange={(event) => editItemQuantity(key, event.target.value)}
                                  onBlur={() => finishEditingItemQuantity(key)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') event.currentTarget.blur();
                                  }}
                                  readOnly={!isOpen}
                                  className="h-9 w-9 border-x border-[var(--zm-line)] bg-transparent px-0 text-center text-[13px] font-semibold tabular-nums text-[var(--zm-ink)] outline-none focus:bg-[var(--zm-surface-muted)] focus:ring-2 focus:ring-inset focus:ring-[var(--zm-brand)]"
                                />
                                <button
                                  type="button"
                                  onClick={() => changeItemQuantity(key, item.quantity + 1)}
                                  className="flex h-9 w-9 items-center justify-center text-[var(--zm-ink-soft)] transition-transform active:scale-90"
                                  aria-label={`Aumentar ${item.productName}`}
                                >
                                  <Plus className="h-4 w-4" strokeWidth={1.8} />
                                </button>
                              </div>
                              <span className="w-[58px] flex-none text-right text-[13px] font-semibold tabular-nums">{toBRL(item.lineTotal)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* ── Recomendações "Peça também" ── */}
                    {(() => {
                      if (!payload.business.recommendationsEnabled) return null;
                      const cartProductIds = draft.items.map((i) => i.productId).filter((id): id is number => id != null);
                      const suggestions = resolveCheckoutSuggestions({
                        enabled: true,
                        recommendationProductIds: payload.business.recommendationProductIds ?? [],
                        catalog: payload.catalog,
                        cartProductIds,
                        max: 10,
                      });
                      if (suggestions.length === 0) return null;
                      return (
                        <div className="mt-1">
                          <p className="mb-2 text-[13px] font-semibold text-[var(--zm-ink)]">Complete seu pedido</p>
                          <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1" style={{ scrollSnapType: 'x mandatory' }}>
                            {suggestions.map((p) => (
                              <div
                                key={p.id}
                                className="flex w-[130px] shrink-0 flex-col rounded-xl border border-[var(--zm-line)] bg-[var(--zm-surface)] p-2"
                                style={{ scrollSnapAlign: 'start' }}
                              >
                                {p.photoUrl ? (
                                  <img src={p.photoUrl} alt={p.name} className="mb-1.5 h-[72px] w-full rounded-lg object-cover" />
                                ) : (
                                  <div className="mb-1.5 flex h-[72px] items-center justify-center rounded-lg bg-[var(--zm-surface-muted)] text-[var(--zm-ink-soft)/50]">
                                    <ImageIcon className="h-6 w-6" strokeWidth={1.4} />
                                  </div>
                                )}
                                <p className="line-clamp-2 text-[12px] font-medium leading-tight text-[var(--zm-ink)]">{p.name}</p>
                                <p className="mt-0.5 text-[11px] tabular-nums text-[var(--zm-ink-soft)]">{toBRL(p.basePrice)}</p>
                                <button
                                  type="button"
                                  disabled={!isOpen}
                                  onClick={() => {
                                    const hasRequired = p.modifierGroups.some((g) =>
                                      g.active && (g.minSelections > 0 || (g.allowsQuantity && g.minTotalQuantity > 0)),
                                    );
                                    if (hasRequired) {
                                      setRecModalProduct(p);
                                      setRecModalSelections({});
                                    } else {
                                      setDraft((cur) => {
                                        if (!cur) return cur;
                                        return {
                                          ...cur,
                                          items: [...cur.items, {
                                            productId: p.id,
                                            productName: p.name,
                                            quantity: 1,
                                            notes: '',
                                            selectedOptions: [],
                                            selectedModifiers: [],
                                            baseUnitPrice: p.basePrice,
                                            modifierDeltaTotal: 0,
                                          }],
                                        };
                                      });
                                      toast.success('Adicionado ao pedido');
                                    }
                                  }}
                                  className="mt-auto flex h-8 w-full items-center justify-center gap-1 rounded-lg bg-[var(--zm-brand)] text-[12px] font-bold text-white transition-transform active:scale-95 disabled:opacity-40"
                                >
                                  <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                                  Adicionar
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {isTableOrder && (
                      <label className="flex flex-col gap-1.5">
                        <span className="text-[11.5px] font-semibold text-[var(--zm-ink-soft)]">Observações (opcional)</span>
                        <textarea
                          value={draft.observations}
                          onChange={(event) => updateField('observations', event.target.value)}
                          readOnly={!isOpen}
                          placeholder="Ex: sem cebola, ponto da carne bem passado…"
                          rows={3}
                          className="w-full resize-none rounded-lg border border-[var(--zm-line)] bg-[var(--zm-surface)] px-3 py-2.5 text-[14px] text-[var(--zm-ink)] outline-none transition-colors focus:border-[var(--zm-brand)]"
                        />
                      </label>
                    )}
                  </div>
                </section>

                {/* PASSO 2 — entrega/retirada */}
                <section inert={step !== 1} className="h-full w-1/3 overflow-y-auto">
                  <div className="flex flex-col p-4">
                    <div className="flex flex-col gap-2">
                      <span className={labelCls}>Como você quer receber?</span>
                      <div className="flex gap-1 rounded-xl border border-[var(--zm-line)] bg-[var(--zm-surface-muted)] p-1">
                        <button
                          type="button"
                          disabled={!isOpen || !deliveryEnabled}
                          onClick={() => updateField('fulfillmentType', 'delivery')}
                          aria-pressed={isDelivery}
                          className={segCls(isDelivery)}
                        >
                          <Bike className="h-4 w-4" strokeWidth={1.8} />
                          Entrega
                        </button>
                        <button
                          type="button"
                          disabled={!isOpen}
                          onClick={() => updateField('fulfillmentType', 'pickup')}
                          aria-pressed={!isDelivery}
                          className={segCls(!isDelivery)}
                        >
                          <ShoppingBag className="h-4 w-4" strokeWidth={1.8} />
                          Retirada
                        </button>
                      </div>
                      {!deliveryEnabled ? (
                        <span className="text-[11px] text-[var(--zm-ink-soft)]">Esta loja está só com retirada no momento.</span>
                      ) : null}
                    </div>

                    <label className="mt-4 flex flex-col gap-1.5">
                      <span className={labelCls}>Seu nome {requiredMark}</span>
                      <input
                        value={draft.customerName}
                        onChange={(event) => updateField('customerName', event.target.value)}
                        readOnly={!isOpen}
                        required
                        aria-invalid={showErrors && Boolean(detailErrors.customerName)}
                        className={`${inputCls} ${showErrors && detailErrors.customerName ? invalidInputCls : ''}`}
                        placeholder="Como te chamamos"
                      />
                      {fieldError(detailErrors.customerName)}
                    </label>

                    <label className="mt-4 flex flex-col gap-1.5">
                      <span className={labelCls}>WhatsApp {requiredMark}</span>
                      <input
                        value={draft.customerPhone}
                        onChange={(event) => updateField('customerPhone', event.target.value)}
                        inputMode="tel"
                        readOnly={!isOpen || !isPublicOrder}
                        required
                        aria-invalid={showErrors && Boolean(detailErrors.customerPhone)}
                        className={`${inputCls} ${isPublicOrder ? '' : 'bg-[var(--zm-surface-muted)] text-[var(--zm-ink-soft)]'} ${showErrors && detailErrors.customerPhone ? invalidInputCls : ''}`}
                        placeholder="(XX) XXXXX-XXXX"
                      />
                      {fieldError(detailErrors.customerPhone)}
                    </label>

                    {isPublicOrder ? (
                      <div className="mt-3 rounded-xl border border-[var(--zm-line)] bg-[var(--zm-surface-muted)] p-3">
                        <label className="flex items-start gap-2.5 text-[12px] leading-snug text-[var(--zm-ink-soft)]">
                          <input
                            type="checkbox"
                            checked={rememberCustomerData}
                            onChange={(event) => {
                              const granted = event.target.checked;
                              setRememberCustomerData(granted);
                              const customerSlug = payload?.session.metadata.slug;
                              if (typeof customerSlug === 'string') {
                                setZeloMenuCustomerCacheConsent(customerSlug, granted);
                                if (!granted) clearZeloMenuCustomerCache(customerSlug);
                              }
                            }}
                            className="mt-0.5 h-4 w-4 flex-none accent-[var(--zm-brand)]"
                          />
                          <span>
                            Lembrar meus dados neste dispositivo por até 7 dias para agilizar o próximo pedido.
                          </span>
                        </label>
                        {rememberCustomerData ? (
                          <button
                            type="button"
                            onClick={() => {
                              const customerSlug = payload?.session.metadata.slug;
                              if (typeof customerSlug !== 'string') return;
                              clearZeloMenuCustomerCache(customerSlug);
                              setRememberCustomerData(false);
                              toast.info('Dados salvos removidos deste dispositivo.');
                            }}
                            className="mt-2 pl-6 text-[11px] font-semibold text-[var(--color-alert)] underline underline-offset-2"
                          >
                            Apagar dados salvos
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    <div className={`grid transition-[grid-template-rows,opacity,margin-top] duration-[380ms] ease-[cubic-bezier(.22,.61,.36,1)] motion-reduce:transition-none ${isDelivery ? 'mt-4 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'}`}>
                      <div className="min-h-0 overflow-hidden">
                        <div className="flex flex-col gap-4">
                          {deliveryEstimateLabel ? (
                            <p className="rounded-xl border border-[var(--zm-brand-soft)] bg-[var(--zm-brand-soft)]/45 px-3 py-2.5 text-sm leading-relaxed text-[var(--zm-brand-deep)]">
                              Tempo estimado de entrega: <strong>{deliveryEstimateLabel}</strong>
                            </p>
                          ) : null}
                          <label className="flex flex-col gap-1.5">
                            <span className={labelCls}>CEP *</span>
                            <input
                              value={draft.deliveryPostalCode}
                              onChange={(event) => updateField('deliveryPostalCode', event.target.value.replace(/\D/g, '').slice(0, 8))}
                              readOnly={!isOpen}
                              inputMode="numeric"
                              required
                              onFocus={beginDeliveryAddressEdit}
                              onBlur={() => {
                                endDeliveryAddressEdit();
                                void lookupDeliveryCep();
                              }}
                              className={inputCls}
                              placeholder="00000-000"
                            />
                            {deliveryCepLoading ? <Loader2 className="h-4 w-4 animate-spin text-[var(--zm-primary)]" /> : null}
                          </label>

                          <label className="flex flex-col gap-1.5">
                            <span className={labelCls}>Rua {requiredMark}</span>
                            <input
                              value={draft.deliveryStreet}
                              onChange={(event) => updateField('deliveryStreet', event.target.value)}
                              readOnly={!isOpen}
                              required
                              className={inputCls}
                              placeholder="Rua, avenida..."
                            />
                          </label>

                          <div className="grid grid-cols-2 gap-3">
                            <label className="flex flex-col gap-1.5">
                              <span className={labelCls}>Número {requiredMark}</span>
                              <input value={draft.deliveryNumber} onChange={(event) => updateField('deliveryNumber', event.target.value)} readOnly={!isOpen} required className={inputCls} placeholder="123" />
                            </label>
                            <label className="flex flex-col gap-1.5">
                              <span className={labelCls}>Complemento</span>
                              <input value={draft.deliveryComplement} onChange={(event) => updateField('deliveryComplement', event.target.value)} onFocus={beginDeliveryAddressEdit} onBlur={endDeliveryAddressEdit} readOnly={!isOpen} className={inputCls} placeholder="Apto, bloco..." />
                            </label>
                          </div>

                          <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_72px] gap-3">
                            <label className="flex min-w-0 flex-col gap-1.5">
                              <span className={labelCls}>Bairro</span>
                              <input
                                value={draft.deliveryNeighborhood}
                                readOnly
                                className={`${inputCls} bg-[var(--zm-surface-muted)] text-[var(--zm-ink-soft)]`}
                                placeholder="Preenchido pelo CEP"
                              />
                            </label>
                            <label className="flex min-w-0 flex-col gap-1.5">
                              <span className={labelCls}>Cidade</span>
                              <input
                                value={draft.deliveryCity}
                                readOnly
                                className={`${inputCls} bg-[var(--zm-surface-muted)] text-[var(--zm-ink-soft)]`}
                                placeholder="Preenchida pelo CEP"
                              />
                            </label>
                            <label className="flex min-w-0 flex-col gap-1.5">
                              <span className={labelCls}>UF</span>
                              <input
                                value={draft.deliveryState}
                                readOnly
                                className={`${inputCls} bg-[var(--zm-surface-muted)] text-[var(--zm-ink-soft)]`}
                                placeholder="UF"
                              />
                            </label>
                          </div>

                          {fieldError(detailErrors.deliveryAddress)}
                          {deliveryQuoteState === 'missing_address' ? (
                            <span className="text-[11px] leading-snug text-[var(--zm-ink-soft)]">
                              Informe o CEP e o número para calcular a entrega.
                            </span>
                          ) : null}
                          {deliveryQuoteModalOpen ? (
                            <div
                              role="dialog"
                              aria-modal="true"
                              aria-labelledby="zelomenu-delivery-quote-title"
                              aria-describedby="zelomenu-delivery-quote-description"
                              className="zelomenu-delivery-quote-modal"
                            >
                              <div className="zelomenu-delivery-quote-modal__surface">
                                <div className="zelomenu-delivery-quote-modal__icon" aria-hidden="true">
                                  <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.9} />
                                </div>
                                <div role="status" aria-live="polite" className="flex min-w-0 flex-col gap-1">
                                  <h2 id="zelomenu-delivery-quote-title" className="text-[14px] font-bold text-[var(--zm-ink)]">Calculando a entrega</h2>
                                  <p id="zelomenu-delivery-quote-description" className="text-[12px] leading-snug text-[var(--zm-ink-soft)]">Validando a melhor rota para este endereço.</p>
                                </div>
                                <div aria-hidden="true" className="zelomenu-delivery-quote-modal__progress" />
                              </div>
                            </div>
                          ) : null}
                          {deliveryQuoteState === 'out_of_area' ? (
                            <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-[var(--color-alert-soft)] bg-[var(--color-alert-soft)] p-3 text-[var(--color-alert)]">
                              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" strokeWidth={1.9} />
                              <span className="text-[11.5px] leading-snug">Este endereço está fora da área de entrega.</span>
                            </div>
                          ) : null}
                          {deliveryQuoteState === 'unavailable' ? (
                            <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-[var(--color-alert-soft)] bg-[var(--color-alert-soft)] p-3 text-[var(--color-alert)]">
                              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" strokeWidth={1.9} />
                              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                                <span className="text-[11.5px] leading-snug">Não conseguimos calcular a taxa agora. Tente novamente para continuar.</span>
                                <button
                                  type="button"
                                  disabled={saveStatus === 'saving'}
                                  onClick={() => {
                                    const latest = latestAutosaveRef.current;
                                    if (latest) void enqueueAutosave(latest);
                                  }}
                                  className="self-start text-[11px] font-semibold underline underline-offset-2 disabled:opacity-50"
                                >
                                  Tentar novamente
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col gap-2">
                      <span className={labelCls}>Quando?</span>
                      <div className="flex gap-1 rounded-xl border border-[var(--zm-line)] bg-[var(--zm-surface-muted)] p-1">
                        <button type="button" disabled={!isOpen} onClick={enableAsap} aria-pressed={scheduleMode === 'asap'} className={segCls(scheduleMode === 'asap')}>
                          <Zap className="h-4 w-4" strokeWidth={1.8} />
                          Pra já
                        </button>
                        <button type="button" disabled={!isOpen} onClick={enableScheduled} aria-pressed={scheduleMode === 'scheduled'} className={segCls(scheduleMode === 'scheduled')}>
                          <CalendarClock className="h-4 w-4" strokeWidth={1.8} />
                          Agendar
                        </button>
                      </div>
                      {scheduleMode === 'asap' ? (
                        <p className="text-[11.5px] leading-snug text-[var(--zm-ink-soft)]">
                          {isDelivery ? 'Entrega o quanto antes.' : 'Retirada o quanto antes.'} Data e horário serão preenchidos automaticamente. É uma encomenda para outro momento? Toque em <span className="font-semibold text-[var(--zm-ink-soft)]">Agendar</span>.
                        </p>
                      ) : (
                        <div className="flex flex-col gap-3">
                          {/* Custom monthly calendar */}
                          <div className="rounded-xl border border-[var(--zm-line)] bg-[var(--zm-surface)] p-3">
                            <ZeloMenuScheduleCalendar
                              value={draft.pickupDate}
                              onChange={(date) => {
                                const bh = payload?.business?.businessHours;
                                if (draft?.pickupTime && bh?.configured) {
                                  const tz = bh.timezone || 'America/Sao_Paulo';
                                  const result = validateScheduling(
                                    bh.weeklySchedule,
                                    { enabled: bh.schedulingEnabled, leadTimeMinutes: bh.schedulingLeadTimeMinutes },
                                    tz, date, draft.pickupTime, new Date(),
                                  );
                                  if (result.ok) {
                                    updateField('pickupDate', date);
                                  } else if (result.nextEligible) {
                                    setDraft((c) => c
                                      ? { ...c, pickupDate: result.nextEligible!.date, pickupTime: result.nextEligible!.time }
                                      : c);
                                  }
                                } else {
                                  updateField('pickupDate', date);
                                }
                              }}
                              minDate={earliestPickup?.date ?? todayISOdate()}
                              maxDaysAhead={90}
                              isDayOpen={(date) => {
                                const bh = payload?.business?.businessHours;
                                if (!bh) return true;
                                const lbl = businessDayLabel(date);
                                if (!lbl) return false;
                                if ((bh.closedDays ?? []).includes(lbl)) return false;
                                if (bh.weeklySchedule) {
                                  const LABEL_TO_KEY: Record<string, DayKey> = { Dom:'sun', Seg:'mon', Ter:'tue', Qua:'wed', Qui:'thu', Sex:'fri', Sáb:'sat' };
                                  const key = LABEL_TO_KEY[lbl];
                                  const ws = key ? bh.weeklySchedule[key] : undefined;
                                  return !!ws && ws.length > 0;
                                }
                                return true;
                              }}
                              timezone={payload?.business?.businessHours?.timezone || 'America/Sao_Paulo'}
                            />
                          </div>

                          <div className="flex gap-3">
                            <label className="flex flex-1 flex-col gap-1.5">
                              <span className={labelCls}>Hora {requiredMark}</span>
                              <select
                                value={draft.pickupTime ? Number(draft.pickupTime.split(':')[0]) : ''}
                                onChange={(e) => {
                                  const h = Number(e.target.value);
                                  const m = availableSlots?.minutesByHour[h]?.[0] ?? 0;
                                  updateField('pickupTime', `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
                                }}
                                disabled={!isOpen || !availableSlots}
                                required
                                className={`${inputCls} ${showErrors && detailErrors.pickupTime ? invalidInputCls : ''}`}
                                style={{ minHeight: '44px' }}
                                aria-label="Hora"
                              >
                                {availableSlots?.hours.map((h) => (
                                  <option key={h} value={h}>{String(h).padStart(2, '0')}h</option>
                                ))}
                              </select>
                              {fieldError(detailErrors.pickupTime)}
                            </label>
                            <label className="flex flex-1 flex-col gap-1.5">
                              <span className={labelCls}>Minuto {requiredMark}</span>
                              <select
                                value={draft.pickupTime ? Number(draft.pickupTime.split(':')[1]) : ''}
                                onChange={(e) => {
                                  const [hourPart] = (draft.pickupTime ?? ':').split(':');
                                  updateField('pickupTime', `${hourPart}:${String(Number(e.target.value)).padStart(2, '0')}`);
                                }}
                                disabled={!isOpen || !availableSlots}
                                required
                                className={`${inputCls} ${showErrors && detailErrors.pickupTime ? invalidInputCls : ''}`}
                                style={{ minHeight: '44px' }}
                                aria-label="Minuto"
                              >
                                {draft.pickupTime ? (
                                  (availableSlots?.minutesByHour[Number(draft.pickupTime.split(':')[0])] ?? []).map((m) => (
                                    <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                                  ))
                                ) : null}
                              </select>
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* PASSO 3 — pagamento + confirmação */}
                <section inert={step !== 2} className="h-full w-1/3 overflow-y-auto">
                  <div className="flex flex-col gap-4 p-4">
                    <div className="flex items-center gap-2 text-[13px] font-semibold">
                      <Wallet className="h-4 w-4 text-[var(--zm-ink-soft)]" strokeWidth={1.8} />
                      Forma de pagamento
                    </div>
                    <div className="flex flex-col gap-2">
                      {PAYMENT_OPTIONS.map((opt) => {
                        const selected = paymentSelection === opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            disabled={!isOpen}
                            onClick={() => updateField('paymentMethod', opt === 'Outro' ? '' : opt)}
                            aria-pressed={selected}
                            className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${selected ? 'border-[var(--zm-brand)] bg-[var(--zm-brand-soft)]' : 'border-[var(--zm-line)] bg-[var(--zm-surface)]'}`}
                          >
                            <span className={`flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border-2 ${selected ? 'border-[var(--zm-brand)]' : 'border-[var(--zm-line-strong)]'}`}>
                              {selected ? <span className="h-2 w-2 rounded-full bg-[var(--zm-brand)]" /> : null}
                            </span>
                            <span className={selected ? 'text-[var(--zm-brand-deep)]' : 'text-[var(--zm-ink-soft)]'}>{paymentIcon(opt)}</span>
                            <span className="text-[13.5px] font-semibold text-[var(--zm-ink)]">{opt}</span>
                          </button>
                        );
                      })}
                    </div>

                    {paymentSelection === 'Outro' ? (
                      <label className="flex flex-col gap-1.5">
                        <span className={labelCls}>Detalhe do pagamento</span>
                        <input
                          value={draft.paymentMethod}
                          onChange={(event) => updateField('paymentMethod', event.target.value)}
                          readOnly={!isOpen}
                          className={inputCls}
                          placeholder="Ex.: Vale alimentação"
                        />
                      </label>
                    ) : null}

                    {payload.business.pixEnabled && /pix/i.test(draft.paymentMethod) ? (
                      <div className="flex items-start gap-2 rounded-xl border border-[var(--zm-brand-soft)] bg-[var(--zm-brand-soft)] p-3 text-[12px] leading-relaxed text-[var(--zm-brand-deep)]">
                        <CheckCircle2 className="mt-px h-3.5 w-3.5 flex-none" strokeWidth={2} />
                        <span>
                          {pixReceiptRequired
                            ? 'Depois de pagar, envie o comprovante pelo WhatsApp se a loja solicitar.'
                            : 'Depois de pagar, aguarde a atualização do pedido nesta tela.'}
                        </span>
                      </div>
                    ) : null}

                    <label className="flex flex-col gap-1.5">
                      <span className={labelCls}>Observações (opcional)</span>
                      <textarea
                        value={draft.observations}
                        onChange={(event) => updateField('observations', event.target.value)}
                        readOnly={!isOpen}
                        rows={3}
                        className="w-full rounded-lg border border-[var(--zm-line)] bg-[var(--zm-surface)] px-3 py-3 text-[14px] text-[var(--zm-ink)] outline-none transition-colors focus:border-[var(--zm-brand)]"
                        placeholder="Ex.: sem cebola, troco para R$ 100, deixar na portaria"
                      />
                    </label>

                    {/* Coupon input */}
                    <label className="block">
                      <span className="mb-1 block text-[12px] font-medium text-[var(--zm-ink-soft)]">
                        Cupom de desconto
                      </span>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={draft.couponCode}
                          onChange={(e) => setDraft((prev) => prev ? { ...prev, couponCode: e.target.value.toUpperCase() } : prev)}
                          placeholder="Código do cupom"
                          disabled={!isOpen}
                          maxLength={30}
                          className="block w-full rounded-lg border border-[var(--zm-line)] bg-[var(--zm-surface)] px-3 py-3 text-[14px] text-[var(--zm-ink)] outline-none transition-colors focus:border-[var(--zm-brand)] disabled:opacity-50"
                        />
                        {draft.couponCode && (
                          <button
                            type="button"
                            onClick={() => setDraft((prev) => prev ? { ...prev, couponCode: '' } : prev)}
                            className="self-start rounded-lg p-3 text-[var(--zm-ink-soft)] transition-colors hover:bg-[var(--zm-line)]"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </label>

                    <div className="flex items-center gap-2 text-[13px] font-semibold">
                      <ShoppingCart className="h-4 w-4 text-[var(--zm-ink-soft)]" strokeWidth={1.8} />
                      Resumo
                    </div>
                    <div className="flex flex-col gap-2.5 rounded-xl border border-[var(--zm-line)] bg-[var(--zm-surface)] p-3.5">
                      <div className="flex items-center justify-between text-[13px] text-[var(--zm-ink-soft)]">
                        <span>Itens</span>
                        <span className="tabular-nums">{toBRL(estimated.subtotal)}</span>
                      </div>
                      <div className="flex items-center justify-between text-[13px] text-[var(--zm-ink-soft)]">
                        <span>{isDelivery ? 'Entrega' : 'Retirada'}</span>
                        <span className="tabular-nums">
                          {isDelivery ? (feeToConfirm ? 'a confirmar' : toBRL(fee)) : 'sem taxa'}
                        </span>
                      </div>
                      {isDelivery && !feeToConfirm && payload.session.fulfillment.deliveryPricingMode === 'custom_time' && (
                        <div className="flex justify-end text-[11.5px] text-[var(--zm-ink-soft)]">
                          Tarifa personalizada · {payload.session.fulfillment.deliveryPricingRuleLabel}
                        </div>
                      )}
                      {payload.session.pricing.discount > 0 && (
                        <div className="flex items-center justify-between text-[13px] text-[var(--color-success)]">
                          <span>Desconto{payload.session.pricing.couponCode ? ` (${payload.session.pricing.couponCode})` : ''}</span>
                          <span className="tabular-nums">-{toBRL(payload.session.pricing.discount)}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between border-t border-[var(--zm-line)] pt-2.5 text-[15px] font-bold text-[var(--zm-ink)]">
                        <span>Total</span>
                        <span className="tabular-nums">{feeToConfirm ? `${toBRL(payload.session.pricing.subtotal)} +` : toBRL(payload.session.pricing.total)}</span>
                      </div>
                      <p className="text-[11.5px] leading-relaxed text-[var(--zm-ink-soft)]">{summaryMeta}</p>
                    </div>
                  </div>
                </section>
              </div>
            </div>

            {/* footer — total ao vivo + CTA sempre visível */}
            <div className="flex-none border-t border-[var(--zm-line)] bg-[var(--zm-surface)] px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
              <div className="mb-2 flex min-h-4 justify-end" aria-live="polite">
                {saveStatus === 'saving' ? (
                  <span className="text-[10.5px] text-[var(--zm-ink-soft)]">Salvando alterações…</span>
                ) : saveStatus === 'saved' ? (
                  <span className="text-[10.5px] text-[var(--zm-brand-deep)]">Alterações salvas</span>
                ) : saveStatus === 'error' ? (
                  <button
                    type="button"
                    onClick={() => {
                      const latest = latestAutosaveRef.current;
                      if (latest) void enqueueAutosave(latest);
                    }}
                    className="text-[10.5px] font-semibold text-[var(--color-alert)] underline underline-offset-2"
                  >
                    Não foi possível salvar. Tentar novamente
                  </button>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <div className="flex flex-col leading-tight">
                  <span className="text-[11px] font-semibold text-[var(--zm-ink-soft)]">{isTableOrder || step === 0 ? 'Subtotal' : 'Total'}</span>
                  <span className="text-[19px] font-bold tabular-nums tracking-tight">{footValue}</span>
                  {footSub ? <span className="text-[10.5px] text-[var(--zm-ink-soft)/50]">{footSub}</span> : null}
                </div>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={ctaDisabled}
                  className="flex h-[50px] flex-1 items-center justify-center gap-2 rounded-2xl bg-[var(--zm-brand)] text-[14.5px] font-semibold text-white transition-transform active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {(confirming && step === 2) || (isDelivery && step === 1 && deliveryQuoteState === 'calculating')
                    ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
                    : null}
                  {ctaLabel}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Modifier modal para recomendações ── */}
      {recModalProduct ? (
        <ModifierModal
          product={recModalProduct}
          selections={recModalSelections}
          onClose={() => { setRecModalProduct(null); setRecModalSelections({}); }}
          onToggle={(groupId, optionId) => {
            setRecModalSelections((prev) => {
              const group = recModalProduct.modifierGroups.find((g) => g.id === groupId);
              if (!group) return prev;
              const current = { ...(prev[groupId] ?? {}) };
              if (current[optionId]) {
                delete current[optionId];
              } else if (group.maxSelections === 1) {
                return { ...prev, [groupId]: { [optionId]: 1 } };
              } else if (group.maxSelections == null || Object.keys(current).length < group.maxSelections) {
                current[optionId] = 1;
              }
              return { ...prev, [groupId]: current };
            });
          }}
          onQuantityChange={(groupId, optionId, quantity) => {
            setRecModalSelections((prev) => {
              const group = recModalProduct.modifierGroups.find((g) => g.id === groupId);
              if (!group) return prev;
              const current = { ...(prev[groupId] ?? {}) };
              const currentTotal = Object.values(current).reduce((total, value) => total + value, 0);
              const currentQuantity = current[optionId] ?? 0;
              if (quantity <= 0) delete current[optionId];
              else {
                const max = Math.min(
                  group.maxPerOption ?? Number.MAX_SAFE_INTEGER,
                  group.maxTotalQuantity == null
                    ? Number.MAX_SAFE_INTEGER
                    : Math.max(0, group.maxTotalQuantity - currentTotal + currentQuantity),
                );
                if (max <= 0) delete current[optionId];
                else current[optionId] = Math.min(quantity, max);
              }
              return { ...prev, [groupId]: current };
            });
          }}
          onConfirm={() => {
            if (!recModalProduct) return;
            const selectedOptions = Object.entries(recModalSelections)
              .map(([groupId, options]) => ({
                groupId,
                optionSelections: Object.entries(options).map(([optionId, quantity]) => ({ optionId, quantity })),
              }))
              .filter((sel) => sel.optionSelections.length > 0);
            const resolution = resolveModifierSelections(recModalProduct.modifierGroups, selectedOptions, recModalProduct.basePrice);
            if (!resolution.ok) return;
            setDraft((cur) => {
              if (!cur) return cur;
              return {
                ...cur,
                items: [...cur.items, {
                  productId: recModalProduct.id,
                  productName: recModalProduct.name,
                  quantity: 1,
                  notes: '',
                  selectedOptions,
                  selectedModifiers: resolution.selectedGroups,
                  baseUnitPrice: recModalProduct.basePrice,
                  modifierDeltaTotal: resolution.deltaTotal,
                }],
              };
            });
            setRecModalProduct(null);
            setRecModalSelections({});
            toast.success('Adicionado ao pedido');
          }}
        />
      ) : null}
    </div>
  );
}

export default function ZeloMenuCartPage() {
  return (
    <ToastProvider>
      <ZeloMenuCartPageContent />
    </ToastProvider>
  );
}
