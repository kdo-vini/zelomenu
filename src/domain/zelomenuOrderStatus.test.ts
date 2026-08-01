import { describe, it, expect } from 'vitest';
import { normalizePublicOrderStatus, resolveOrderStatus } from './zelomenuOrderStatus';

describe('resolveOrderStatus', () => {
  // ── Delivery progression ─────────────────────────────────────────────────

  it('delivery: pending_payment → step index 0', () => {
    const r = resolveOrderStatus('pending_payment', true);
    expect(r.isTerminal).toBe(false);
    expect(r.currentStepIndex).toBe(0);
    expect(r.steps).toHaveLength(6);
    expect(r.steps[0].label).toBe('Pedido recebido');
  });

  it('delivery: pending_review → step index 0', () => {
    const r = resolveOrderStatus('pending_review', true);
    expect(r.currentStepIndex).toBe(0);
  });

  it('delivery: accepted → step index 1', () => {
    const r = resolveOrderStatus('accepted', true);
    expect(r.currentStepIndex).toBe(1);
  });

  it('delivery: preparing → step index 2', () => {
    const r = resolveOrderStatus('preparing', true);
    expect(r.currentStepIndex).toBe(2);
  });

  it('delivery: ready → step index 3', () => {
    const r = resolveOrderStatus('ready', true);
    expect(r.currentStepIndex).toBe(3);
    expect(r.steps[3].label).toBe('Pronto');
  });

  it('delivery: out_for_delivery → step index 4', () => {
    const r = resolveOrderStatus('out_for_delivery', true);
    expect(r.currentStepIndex).toBe(4);
    expect(r.steps[4].label).toBe('Saiu para entrega');
  });

  it('delivery: delivered → step index 5 (final)', () => {
    const r = resolveOrderStatus('delivered', true);
    expect(r.currentStepIndex).toBe(5);
    expect(r.steps[5].label).toBe('Entregue');
  });

  it('delivery: full progression lands each step correctly', () => {
    const statuses = ['pending_payment', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered'];
    for (let i = 0; i < statuses.length; i++) {
      const r = resolveOrderStatus(statuses[i], true);
      expect(r.currentStepIndex).toBe(i);
    }
  });

  // ── Pickup progression (5 steps, no out_for_delivery) ────────────────────

  it('pickup: has 5 steps', () => {
    const r = resolveOrderStatus('pending_payment', false);
    expect(r.steps).toHaveLength(5);
  });

  it('pickup: ready label is "Pronto para retirada"', () => {
    const r = resolveOrderStatus('ready', false);
    expect(r.currentStepIndex).toBe(3);
    expect(r.steps[3].label).toBe('Pronto para retirada');
  });

  it('pickup: delivered label is "Retirado"', () => {
    const r = resolveOrderStatus('delivered', false);
    expect(r.currentStepIndex).toBe(4);
    expect(r.steps[4].label).toBe('Retirado');
  });

  it('pickup: full progression lands each step correctly', () => {
    const statuses = ['pending_payment', 'accepted', 'preparing', 'ready', 'delivered'];
    for (let i = 0; i < statuses.length; i++) {
      const r = resolveOrderStatus(statuses[i], false);
      expect(r.currentStepIndex).toBe(i);
    }
  });

  // ── Terminal states ──────────────────────────────────────────────────────

  it('cancelled → isTerminal + isCancelled', () => {
    const r = resolveOrderStatus('cancelled', true);
    expect(r.isTerminal).toBe(true);
    expect(r.isCancelled).toBe(true);
  });

  it('rejected → isTerminal but not isCancelled', () => {
    const r = resolveOrderStatus('rejected', true);
    expect(r.isTerminal).toBe(true);
    expect(r.isCancelled).toBe(false);
  });
});

describe('normalizePublicOrderStatus', () => {
  it('maps table-order statuses from the PDV vocabulary', () => {
    expect(normalizePublicOrderStatus('aberto')).toBe('pending_review');
    expect(normalizePublicOrderStatus('em_preparo')).toBe('preparing');
    expect(normalizePublicOrderStatus('pronto')).toBe('ready');
    expect(normalizePublicOrderStatus('entregue')).toBe('delivered');
    expect(normalizePublicOrderStatus('cancelado')).toBe('cancelled');
  });

  it('keeps canonical statuses unchanged', () => {
    expect(normalizePublicOrderStatus('accepted')).toBe('accepted');
    expect(normalizePublicOrderStatus('pending_review')).toBe('pending_review');
  });
});
