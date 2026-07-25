import { X } from 'lucide-react';
import type { DeliveryPricingRuleDraft } from '../../domain/deliverySettings';

function minuteToTimeInput(minute: string): string {
  const m = parseInt(minute, 10);
  if (!Number.isFinite(m)) return '';
  // 1440 = fim do dia (meia-noite), exibe como 00:00
  if (m >= 1440) return '00:00';
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function timeInputToMinute(value: string): string {
  const [h, m] = value.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  return String(h * 60 + m);
}

type DeliveryPricingRuleEditorProps = {
  rule: DeliveryPricingRuleDraft;
  ranges: Array<{ maxDistanceM: number; price: string; label: string }>;
  errors: Record<string, string>;
  onChange: (rule: DeliveryPricingRuleDraft) => void;
  onCancel: () => void;
};

export function DeliveryPricingRuleEditor({ rule, ranges, errors, onChange, onCancel }: DeliveryPricingRuleEditorProps) {
  return (
    <div className="border border-purple-200 rounded-lg p-4 bg-purple-50/50 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-sm text-zinc-800">{rule.label || 'Novo horário'}</h4>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 hover:bg-zinc-200/50 rounded"
          aria-label="Cancelar"
        >
          <X className="w-4 h-4 text-zinc-400" />
        </button>
      </div>

      {/* Label */}
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Nome do horário</label>
        <input
          type="text"
          value={rule.label}
          onChange={(e) => onChange({ ...rule, label: e.target.value })}
          className={`w-full border rounded px-3 py-2 text-sm ${errors.label ? 'border-red-400' : 'border-zinc-300'} focus:outline-none focus:ring-2 focus:ring-purple-300`}
          placeholder="Ex: Noturno"
          maxLength={40}
        />
        {errors.label && <p className="text-xs text-red-500 mt-1">{errors.label}</p>}
      </div>

      {/* Time range */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Início</label>
          <input
            type="time"
            value={minuteToTimeInput(rule.startMinute)}
            onChange={(e) => onChange({ ...rule, startMinute: timeInputToMinute(e.target.value) })}
            className={`w-full border rounded px-3 py-2 text-sm ${errors.startMinute ? 'border-red-400' : 'border-zinc-300'} focus:outline-none focus:ring-2 focus:ring-purple-300`}
          />
          {errors.startMinute && <p className="text-xs text-red-500 mt-1">{errors.startMinute}</p>}
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Fim</label>
          <input
            type="time"
            value={minuteToTimeInput(rule.endMinute)}
            onChange={(e) => onChange({ ...rule, endMinute: rule.endMinute && e.target.value === '00:00' ? '1440' : timeInputToMinute(e.target.value) })}
            className={`w-full border rounded px-3 py-2 text-sm ${errors.endMinute ? 'border-red-400' : 'border-zinc-300'} focus:outline-none focus:ring-2 focus:ring-purple-300`}
          />
          {errors.endMinute && <p className="text-xs text-red-500 mt-1">{errors.endMinute}</p>}
        </div>
      </div>

      {rule.startMinute !== '' && rule.endMinute !== '' && (
        <p className="text-xs text-zinc-400">
          {parseInt(rule.startMinute, 10) >= parseInt(rule.endMinute, 10) && 'Termina no dia seguinte · '}
          A taxa usa o fuso horário da loja.
        </p>
      )}

      {/* Prices per range */}
      <div>
        <label className="block text-xs text-zinc-500 mb-2">Preços por faixa</label>
        <div className="space-y-2">
          {ranges.map((range) => (
            <div key={range.maxDistanceM} className="flex items-center gap-3">
              <span className="text-sm text-zinc-600 w-24 shrink-0">Até {range.label}</span>
              <div className="relative flex-1 max-w-[160px]">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">R$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={rule.prices[String(range.maxDistanceM)] ?? ''}
                  onChange={(e) => onChange({
                    ...rule,
                    prices: { ...rule.prices, [String(range.maxDistanceM)]: e.target.value },
                  })}
                  className={`w-full border rounded pl-8 pr-3 py-2 text-sm ${errors[`price_${range.maxDistanceM}`] ? 'border-red-400' : 'border-zinc-300'} focus:outline-none focus:ring-2 focus:ring-purple-300`}
                  placeholder="0,00"
                />
              </div>
            </div>
          ))}
        </div>
        {errors.prices && <p className="text-xs text-red-500 mt-1">{errors.prices}</p>}
      </div>
    </div>
  );
}
