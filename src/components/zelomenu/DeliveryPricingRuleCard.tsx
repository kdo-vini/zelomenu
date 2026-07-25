import { CheckCircle, Circle, Edit3, MoreHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { DeliveryPricingRuleDraft } from '../../domain/deliverySettings';

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

function minuteToHourMinute(minute: number): string {
  // 1440 = fim do dia (meia-noite)
  if (minute >= 1440) return '00:00';
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return pad2(h) + ':' + pad2(m);
}

function formatPricingWindow(startMinute: string, endMinute: string): string {
  const s = parseInt(startMinute, 10);
  const e = parseInt(endMinute, 10);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return '';
  const crossesMidnight = s >= e;
  return minuteToHourMinute(s) + ' as ' + minuteToHourMinute(e) + (crossesMidnight ? ' · termina no dia seguinte' : '');
}

type DeliveryPricingRuleCardProps = {
  rule: DeliveryPricingRuleDraft;
  ranges: Array<{ maxDistanceM: number; price: string; label: string }>;
  isActive: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onRemove: () => void;
};

export function DeliveryPricingRuleCard({ rule, ranges, isActive, onEdit, onToggle, onRemove }: DeliveryPricingRuleCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const activeNow = isActive && rule.enabled;

  return (
    <div className={'border rounded-lg p-4 ' + (activeNow ? 'border-purple-300 bg-purple-50' : 'border-zinc-200')}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {rule.enabled ? (
            <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
          ) : (
            <Circle className="w-5 h-5 text-zinc-300 shrink-0" />
          )}
          <div className="min-w-0">
            <h4 className="font-medium text-sm text-zinc-800 truncate">{rule.label || 'Novo horario'}</h4>
            <p className="text-xs text-zinc-400">{formatPricingWindow(rule.startMinute, rule.endMinute)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {activeNow && (
            <span className="text-xs font-medium text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">
              Ativo agora
            </span>
          )}
          <div className="relative">
            <button
              type="button"
              className="p-1 hover:bg-zinc-100 rounded"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Acoes"
            >
              <MoreHorizontal className="w-4 h-4 text-zinc-400" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg z-20 py-1 min-w-[140px]">
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                    onClick={() => { onEdit(); setMenuOpen(false); }}
                  >
                    <Edit3 className="w-4 h-4" />
                    Editar
                  </button>
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                    onClick={() => { onToggle(); setMenuOpen(false); }}
                  >
                    {rule.enabled ? (
                      <Circle className="w-4 h-4" />
                    ) : (
                      <CheckCircle className="w-4 h-4" />
                    )}
                    {rule.enabled ? 'Desativar' : 'Ativar'}
                  </button>
                  <hr className="my-1 border-zinc-100" />
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                    onClick={() => { onRemove(); setMenuOpen(false); }}
                  >
                    <Trash2 className="w-4 h-4" />
                    Remover
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Prices per range */}
      <div className="space-y-1">
        {ranges.map((range) => (
          <div key={range.maxDistanceM} className="flex justify-between text-sm">
            <span className="text-zinc-500">Ate {range.label}</span>
            <span className="text-zinc-800 font-medium">
              {rule.prices[String(range.maxDistanceM)]
                ? 'R$ ' + rule.prices[String(range.maxDistanceM)]
                : '\u2014'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
