import { describe, it, expect } from 'vitest';
import {
  resolveZeloMenuCapabilities,
  hasZeloMenuAccess,
  hasOrderingReviewAccess,
  hasKitchenQueueAccess,
  hasZeloMenuCapability,
  ZELOMENU_CAPABILITIES,
  type ZeloMenuEntitlementSignals,
} from './zelomenuEntitlements';

const base: ZeloMenuEntitlementSignals = { planTier: 'pdv', active: true };

describe('resolveZeloMenuCapabilities — truth table', () => {
  it('no active subscription → everything false', () => {
    const caps = resolveZeloMenuCapabilities({ planTier: 'bundle', active: false });
    expect(Object.values(caps).every((v) => v === false)).toBe(true);
  });

  it('no plan tier → everything false', () => {
    const caps = resolveZeloMenuCapabilities({ planTier: null, active: true });
    expect(Object.values(caps).every((v) => v === false)).toBe(true);
  });

  it('pdv + ZeloMenu flag → menu_publication TRUE', () => {
    const caps = resolveZeloMenuCapabilities({ ...base, hasZeloMenuFlag: true });
    expect(caps.menu_publication).toBe(true);
    expect(caps.public_menu_runtime).toBe(true);
    expect(caps.ordering_review).toBe(true);
    expect(caps.kitchen_queue).toBe(true);
    expect(caps.pdv_core).toBe(true);
    expect(caps.chat_app).toBe(false);
  });

  it('pdv-only (no addons) → menu_publication FALSE', () => {
    const caps = resolveZeloMenuCapabilities({ ...base });
    expect(caps.menu_publication).toBe(false);
    expect(caps.public_menu_runtime).toBe(false);
    expect(caps.ordering_review).toBe(false);
    expect(caps.kitchen_queue).toBe(false);
    expect(caps.pdv_core).toBe(true);
  });

  it('pdv + legacy has_pedidos_addon → menu_publication FALSE but ordering_review TRUE (grandfather, D-099)', () => {
    const caps = resolveZeloMenuCapabilities({ ...base, hasPedidosAddonLegacy: true });
    expect(caps.menu_publication).toBe(false);
    expect(caps.public_menu_runtime).toBe(false);
    expect(caps.ordering_review).toBe(true);
    expect(caps.kitchen_queue).toBe(true);
  });

  it('pdv + legacy null/undefined ZeloMenu flag → still no publication', () => {
    expect(resolveZeloMenuCapabilities({ ...base, hasZeloMenuFlag: null }).menu_publication).toBe(false);
    expect(resolveZeloMenuCapabilities({ ...base, hasZeloMenuFlag: undefined }).menu_publication).toBe(false);
    expect(resolveZeloMenuCapabilities({ ...base, hasZeloMenuFlag: false }).menu_publication).toBe(false);
  });

  it('chat tier → menu_publication TRUE (D-014, fail-safe ON even without flag)', () => {
    const caps = resolveZeloMenuCapabilities({ planTier: 'chat', active: true });
    expect(caps.menu_publication).toBe(true);
    expect(caps.ordering_review).toBe(true);
    expect(caps.kitchen_queue).toBe(true);
    expect(caps.chat_app).toBe(true);
    expect(caps.pdv_core).toBe(false);
  });

  it('bundle tier → menu_publication TRUE and both apps', () => {
    const caps = resolveZeloMenuCapabilities({ planTier: 'bundle', active: true });
    expect(caps.menu_publication).toBe(true);
    expect(caps.ordering_review).toBe(true);
    expect(caps.kitchen_queue).toBe(true);
    expect(caps.chat_app).toBe(true);
    expect(caps.pdv_core).toBe(true);
  });

  it('pdv + mesas addon (no menu/pedidos) → kitchen_queue TRUE without ordering_review (D-100)', () => {
    const caps = resolveZeloMenuCapabilities({ ...base, hasMesasAddon: true });
    expect(caps.ordering_review).toBe(false);
    expect(caps.kitchen_queue).toBe(true);
    expect(caps.mesas).toBe(true);
    expect(caps.menu_publication).toBe(false);
  });

  it('acessos addon flows through', () => {
    expect(resolveZeloMenuCapabilities({ ...base, hasAcessosAddon: true }).acessos).toBe(true);
  });
});

describe('convenience helpers mirror the resolver', () => {
  it('hasZeloMenuAccess === resolver.menu_publication', () => {
    expect(hasZeloMenuAccess({ ...base, hasZeloMenuFlag: true })).toBe(true);
    expect(hasZeloMenuAccess({ ...base, hasPedidosAddonLegacy: true })).toBe(false);
  });
  it('hasOrderingReviewAccess === resolver.ordering_review', () => {
    expect(hasOrderingReviewAccess({ ...base, hasPedidosAddonLegacy: true })).toBe(true);
    expect(hasOrderingReviewAccess({ ...base })).toBe(false);
  });
  it('hasKitchenQueueAccess === resolver.kitchen_queue', () => {
    expect(hasKitchenQueueAccess({ ...base, hasMesasAddon: true })).toBe(true);
    expect(hasKitchenQueueAccess({ ...base })).toBe(false);
  });
  it('hasZeloMenuCapability reads a single flag', () => {
    const caps = resolveZeloMenuCapabilities({ planTier: 'bundle', active: true });
    expect(hasZeloMenuCapability(caps, 'menu_publication')).toBe(true);
    expect(hasZeloMenuCapability(caps, 'mesas')).toBe(false);
  });
});

describe('catalogue is stable', () => {
  it('exposes exactly the 8 known capabilities', () => {
    expect([...ZELOMENU_CAPABILITIES]).toEqual([
      'chat_app',
      'pdv_core',
      'menu_publication',
      'public_menu_runtime',
      'ordering_review',
      'kitchen_queue',
      'mesas',
      'acessos',
    ]);
  });
});
