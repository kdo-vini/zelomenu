import { useState } from 'react';
import { ChevronDown, ChevronUp, Clock, Plus } from 'lucide-react';
import { DeliveryPricingTimeline } from './DeliveryPricingTimeline';
import { DeliveryPricingRuleCard } from './DeliveryPricingRuleCard';
import { DeliveryPricingRuleEditor } from './DeliveryPricingRuleEditor';
import { EMPTY_PRICING_RULE_DRAFT } from '../../domain/deliverySettings';
import { getLocalDateTimeParts, validateDeliveryPricingRules } from '../../domain/zelomenuDelivery';

import type { DeliveryPricingRuleDraft } from '../../domain/deliverySettings';

type DeliveryCustomScheduleDisclosureProps = {
  pricingRules: DeliveryPricingRuleDraft[];
  ranges: Array<{ maxDistanceM: number; price: string; label: string }>;
  enabled: boolean;
  onRulesChange: (rules: DeliveryPricingRuleDraft[]) => void;
};

function isRuleActiveNow(rule: DeliveryPricingRuleDraft): boolean {
  if (!rule.enabled) return false;
  const now = new Date();
  const currentMinute = now.getHours() * 60 + now.getMinutes();
  const start = parseInt(rule.startMinute, 10);
  const end = parseInt(rule.endMinute, 10);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;

  if (start < end) return currentMinute >= start && currentMinute < end;
  return currentMinute >= start || currentMinute < end;
}

function validateRule(rule: DeliveryPricingRuleDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!rule.label.trim()) errors.label = 'Informe um nome.';
  const start = parseInt(rule.startMinute, 10);
  const end = parseInt(rule.endMinute, 10);
  if (!Number.isFinite(start) || start < 0 || start >= 1440) errors.startMinute = 'Horário inválido.';
  if (!Number.isFinite(end) || end < 0 || end > 1440) errors.endMinute = 'Horário inválido.';
  if (Number.isFinite(start) && Number.isFinite(end) && start === end) {
    errors.endMinute = 'Deve ser diferente do início.';
  }
  if (Object.keys(rule.prices).length === 0) errors.prices = 'Informe um preço para cada faixa.';
  for (const [key, value] of Object.entries(rule.prices)) {
    const v = value.replace(',', '.').trim();
    if (!v || isNaN(Number(v)) || Number(v) < 0) {
      errors[`price_${key}`] = 'Preço inválido.';
    }
  }
  return errors;
}

function formatKmLabel(meters: number): string {
  const km = meters / 1000;
  return `${km.toFixed(2).replace('.', ',')} km`;
}

export function DeliveryCustomScheduleDisclosure({ pricingRules, ranges, enabled, onRulesChange }: DeliveryCustomScheduleDisclosureProps) {
  const [open, setOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const contentId = 'delivery-custom-schedule-content';
  const headerId = 'delivery-custom-schedule-header';

  const activeNow = pricingRules.some(isRuleActiveNow);
  const count = pricingRules.length;

  const rangeLabels = ranges.map((r) => ({
    maxDistanceM: r.maxDistanceM,
    price: r.price,
    label: formatKmLabel(r.maxDistanceM),
  }));

  const localMinuteNow = getLocalDateTimeParts(Intl.DateTimeFormat().resolvedOptions().timeZone).localMinute;

  function handleAdd() {
    const initialPrices: Record<string, string> = {};
    for (const r of ranges) {
      initialPrices[String(r.maxDistanceM)] = '0,00';
    }
    const newRule: DeliveryPricingRuleDraft = { ...EMPTY_PRICING_RULE_DRAFT, prices: initialPrices };
    onRulesChange([...pricingRules, newRule]);
    setEditingIndex(pricingRules.length);
    setErrors({});
  }

  function handleEdit(index: number) {
    setEditingIndex(index);
    setErrors({});
  }

  function handleEditorChange(rule: DeliveryPricingRuleDraft) {
    if (editingIndex == null) return;
    const updated = [...pricingRules];
    updated[editingIndex] = rule;
    onRulesChange(updated);
  }

  function handleEditorCancel() {
    // Remove rule if it was new (empty label)
    if (editingIndex != null && !pricingRules[editingIndex].label.trim()) {
      onRulesChange(pricingRules.filter((_, i) => i !== editingIndex));
    }
    setEditingIndex(null);
    setErrors({});
  }

  function handleSaveRule() {
    if (editingIndex == null) return;
    const rule = pricingRules[editingIndex];
    const validation = validateRule(rule);
    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      return;
    }
    // Check overlap with other rules
    const others = pricingRules.filter((_, i) => i !== editingIndex);
    const allRules = [...others, rule];
    const domainRules = allRules.map((r) => ({
      label: r.label,
      startMinute: parseInt(r.startMinute, 10),
      endMinute: parseInt(r.endMinute, 10),
      enabled: r.enabled,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      pricesByDistance: Object.entries(r.prices).map(([k, v]) => ({
        maxDistanceM: parseInt(k, 10),
        price: Number(v.replace(',', '.')) || 0,
      })),
    }));
    const overlapError = validateDeliveryPricingRules(domainRules, ranges.map((r) => ({ maxDistanceM: r.maxDistanceM, price: 0 })));
    if (overlapError) {
      setErrors({ label: overlapError });
      return;
    }
    setEditingIndex(null);
    setErrors({});
  }

  function handleToggle(index: number) {
    const updated = [...pricingRules];
    updated[index] = { ...updated[index], enabled: !updated[index].enabled };
    onRulesChange(updated);
  }

  function handleRemove(index: number) {
    onRulesChange(pricingRules.filter((_, i) => i !== index));
    if (editingIndex === index) setEditingIndex(null);
  }

  if (!enabled || ranges.length === 0) return null;

  const summary = count === 0
    ? 'Opcional · preços por horário'
    : `${count} ${count === 1 ? 'horário' : 'horários'}${activeNow ? ' · Ativo agora' : ''}`;

  return (
    <div className="border-t border-zinc-200 pt-4 mt-4">
      <button
        id={headerId}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={contentId}
        className="w-full flex items-center justify-between text-sm text-zinc-600 hover:text-zinc-800 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Clock className="w-4 h-4" />
          <span className="font-medium">Horários personalizados</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-zinc-400">{summary}</span>
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {open && (
        <div id={contentId} role="region" aria-labelledby={headerId} className="mt-4 space-y-4">
          <p className="text-xs text-zinc-400">
            Ajuste o preço da entrega em períodos de maior demanda. A regra usa o fuso horário configurado para a loja.
          </p>

          {/* Timeline */}
          <DeliveryPricingTimeline
            rules={pricingRules}
            rangesCount={ranges.length}
            localMinuteNow={localMinuteNow}
          />

          {/* Rule cards */}
          {pricingRules.map((rule, i) => (
            editingIndex === i ? (
              <div key={i} className="space-y-3">
                <DeliveryPricingRuleEditor
                  rule={rule}
                  ranges={rangeLabels}
                  errors={errors}
                  onChange={handleEditorChange}
                  onCancel={handleEditorCancel}
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleEditorCancel}
                    className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-700"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveRule}
                    className="px-4 py-1.5 text-sm text-white bg-purple-600 rounded-lg hover:bg-purple-700"
                  >
                    Salvar
                  </button>
                </div>
              </div>
            ) : (
              <DeliveryPricingRuleCard
                key={i}
                rule={rule}
                ranges={rangeLabels}
                isActive={isRuleActiveNow(rule)}
                onEdit={() => handleEdit(i)}
                onToggle={() => handleToggle(i)}
                onRemove={() => handleRemove(i)}
              />
            )
          ))}

          {/* Add button */}
          <button
            type="button"
            onClick={handleAdd}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm text-purple-600 border border-dashed border-purple-300 rounded-lg hover:bg-purple-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Adicionar horário personalizado
          </button>
        </div>
      )}
    </div>
  );
}
