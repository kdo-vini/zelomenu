import { useMemo } from 'react';
import { Clock } from 'lucide-react';
import type { DeliveryPricingRuleDraft } from '../../domain/deliverySettings';

const HOURS = 24;
const MINUTES_IN_DAY = 1440;

function minuteToPercent(minute: number): number {
  return (Math.max(0, Math.min(MINUTES_IN_DAY, minute)) / MINUTES_IN_DAY) * 100;
}

type TimelineSegment = {
  label: string;
  startPercent: number;
  endPercent: number;
  color: string;
  isActive: boolean;
};

type DeliveryPricingTimelineProps = {
  rules: DeliveryPricingRuleDraft[];
  localMinuteNow?: number;
  rangesCount: number;
};

export function DeliveryPricingTimeline({ rules, localMinuteNow, rangesCount }: DeliveryPricingTimelineProps) {
  const segments = useMemo<TimelineSegment[]>(() => {
    const result: TimelineSegment[] = [];
    const activeRules = rules.filter((r) => r.enabled && r.label.trim());

    if (activeRules.length === 0) {
      result.push({ label: 'Preço padrão', startPercent: 0, endPercent: 100, color: 'bg-blue-200', isActive: true });
      return result;
    }

    // Sort rules by start minute
    const sorted = [...activeRules].sort((a, b) => {
      const sa = parseInt(a.startMinute) || 0;
      const sb = parseInt(b.startMinute) || 0;
      return sa - sb;
    });

    // Build segments handling midnight crossing
    const parsed = sorted.map((r) => ({
      rule: r,
      start: parseInt(r.startMinute) || 0,
      end: parseInt(r.endMinute) || 0,
    }));

    // Non-crossing rules: add standard gaps and rule segments
    let cursor = 0;
    for (const p of parsed) {
      if (p.start <= p.end) {
        // Standard interval
        if (p.start > cursor) {
          result.push({ label: 'Preço padrão', startPercent: minuteToPercent(cursor), endPercent: minuteToPercent(p.start), color: 'bg-blue-200', isActive: false });
        }
        result.push({ label: p.rule.label, startPercent: minuteToPercent(p.start), endPercent: minuteToPercent(p.end), color: 'bg-purple-300', isActive: true });
        cursor = Math.max(cursor, p.end);
      }
    }

    // Remaining standard time
    if (cursor < MINUTES_IN_DAY) {
      result.push({ label: 'Preço padrão', startPercent: minuteToPercent(cursor), endPercent: 100, color: 'bg-blue-200', isActive: false });
    }

    // Midnight-crossing rules: add as overflow segments at the start
    for (const p of parsed) {
      if (p.start > p.end) {
        // Crosses midnight: segment from start to midnight
        result.push({ label: p.rule.label, startPercent: minuteToPercent(p.start), endPercent: 100, color: 'bg-purple-300', isActive: true });
        // And from midnight to end
        result.unshift({ label: p.rule.label, startPercent: 0, endPercent: minuteToPercent(p.end), color: 'bg-purple-300', isActive: true });
      }
    }

    return result;
  }, [rules]);

  if (rangesCount === 0) return null;

  const nowPercent = localMinuteNow != null ? minuteToPercent(localMinuteNow) : -1;

  return (
    <div className="space-y-2" role="img" aria-label="Linha do tempo de 24 horas com os horários personalizados">
      {/* Hour markers */}
      <div className="flex justify-between text-xs text-zinc-400">
        {Array.from({ length: HOURS + 1 }, (_, h) => (
          <span key={h} className="w-0 text-center -translate-x-1/2">{String(h).padStart(2, '0')}</span>
        ))}
      </div>

      {/* Segments bar */}
      <div className="relative h-6 rounded-md overflow-hidden bg-zinc-100">
        {segments.map((seg, i) => (
          <div
            key={i}
            className={`absolute top-0 h-full ${seg.color} border-r border-white/40 last:border-r-0`}
            style={{ left: `${seg.startPercent}%`, width: `${seg.endPercent - seg.startPercent}%` }}
            title={seg.label}
          />
        ))}
        {nowPercent >= 0 && (
          <div
            className="absolute top-0 h-full w-0.5 bg-red-500 z-10"
            style={{ left: `${nowPercent}%` }}
            aria-label="Agora"
          />
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        {segments
          .filter((s, i, arr) => arr.findIndex((x) => x.label === s.label) === i)
          .map((s) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span className={`inline-block w-2.5 h-2.5 rounded-sm ${s.color}`} />
              {s.label}
            </span>
          ))}
        {nowPercent >= 0 && (
          <span className="flex items-center gap-1.5 text-red-500">
            <Clock className="w-3 h-3" />
            Agora
          </span>
        )}
      </div>
    </div>
  );
}
