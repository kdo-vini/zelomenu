import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  hasZeloMenuAccess,
  resolveZeloMenuCapabilities,
  type ZeloMenuCapabilitySet,
  type ZeloMenuEntitlementSignals,
} from '../domain/zelomenuEntitlements';
import { supabase } from '../services/supabaseClient';
import { isSubscriptionCurrentlyActive } from '../domain/subscription';

export interface ZeloMenuSubscription {
  id: string;
  status: string;
  plan_tier: 'pdv' | 'chat' | 'bundle' | null;
  current_period_end: string | null;
  manually_extended_until: string | null;
  cancel_at_period_end: boolean | null;
  has_zelo_menu: boolean | null;
  has_pedidos_addon: boolean | null;
  has_mesas_addon: boolean | null;
  has_acessos_addon: boolean | null;
}

export interface UseZeloMenuEntitlementResult {
  /** Latest subscription row (any plan_tier) — null se o user nunca assinou. */
  subscription: ZeloMenuSubscription | null;
  /** Sinais puros passados ao resolver de entitlement. */
  signals: ZeloMenuEntitlementSignals;
  /** Capabilities efetivas do ZeloMenu, resolvidas pelo resolver de domínio. */
  capabilities: ZeloMenuCapabilitySet;
  /** True se o owner pode publicar/configurar o cardápio (gate de /admin). */
  hasAccess: boolean;
  /** True se há assinatura ativa mas SEM ZeloMenu (estado de upsell). */
  isActiveWithoutMenu: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Lê a assinatura do owner na tabela compartilhada `subscriptions` e resolve o
 * entitlement do ZeloMenu via o resolver local (`domain/zelomenuEntitlements`).
 *
 * Espelha o comportamento do ZeloChat (`useSubscription`): pega a row mais
 * recente por `user_id`, calcula `active` (status + expiry) localmente, e passa
 * os sinais ao resolver. Hoje todo `chat`/`bundle` ativo já recebe ZeloMenu
 * (D-014); `pdv` puro depende do flag `has_zelo_menu` (D-103), ainda não
 * exposto neste SELECT.
 */
export function useZeloMenuEntitlement(session: Session | null): UseZeloMenuEntitlementResult {
  const [subscription, setSubscription] = useState<ZeloMenuSubscription | null>(null);
  const [loading, setLoading] = useState(true);

  const userId = session?.user?.id ?? null;

  const load = async () => {
    if (!userId) {
      setSubscription(null);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('subscriptions')
      .select('id, status, plan_tier, current_period_end, manually_extended_until, cancel_at_period_end, has_zelo_menu, has_pedidos_addon, has_mesas_addon, has_acessos_addon')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn('[useZeloMenuEntitlement] load failed:', error.message);
      setSubscription(null);
    } else {
      setSubscription((data ?? null) as ZeloMenuSubscription | null);
    }
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const signals = useMemo<ZeloMenuEntitlementSignals>(
    () => ({
      planTier: subscription?.plan_tier ?? null,
      active: isSubscriptionCurrentlyActive(subscription),
      // D-103: `has_zelo_menu` é PDV-owned e agora está publicada. Quando true,
      // concede ZeloMenu mesmo a um `pdv` puro. chat/bundle já entram por D-014.
      hasZeloMenuFlag: subscription?.has_zelo_menu ?? undefined,
      hasPedidosAddonLegacy: subscription?.has_pedidos_addon ?? undefined,
      hasMesasAddon: subscription?.has_mesas_addon ?? undefined,
      hasAcessosAddon: subscription?.has_acessos_addon ?? undefined,
    }),
    [subscription],
  );

  const capabilities = useMemo(() => resolveZeloMenuCapabilities(signals), [signals]);
  const hasAccess = useMemo(() => hasZeloMenuAccess(signals), [signals]);
  const isActiveWithoutMenu = signals.active && !hasAccess;

  return {
    subscription,
    signals,
    capabilities,
    hasAccess,
    isActiveWithoutMenu,
    loading,
    refresh: load,
  };
}
