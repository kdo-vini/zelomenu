const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const ZELOMENU_DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

export function parseBusinessTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(TIME_PATTERN);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

export function isBusinessWindowOpen(
  minutes: number,
  openMinutes: number,
  closeMinutes: number,
): boolean {
  if (openMinutes <= closeMinutes) {
    return minutes >= openMinutes && minutes <= closeMinutes;
  }
  return minutes >= openMinutes || minutes <= closeMinutes;
}

function zonedDateTimeKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
}

export function isPickupInPast(
  pickupDate: string,
  pickupTime: string,
  timeZone: string,
  now = new Date(),
): boolean | null {
  const dateMatch = pickupDate.match(DATE_PATTERN);
  const pickupMinutes = parseBusinessTime(pickupTime);
  if (!dateMatch || pickupMinutes === null) return null;
  const pickupKey = `${dateMatch[1]}${dateMatch[2]}${dateMatch[3]}${String(Math.floor(pickupMinutes / 60)).padStart(2, '0')}${String(pickupMinutes % 60).padStart(2, '0')}00`;
  return pickupKey < zonedDateTimeKey(now, timeZone);
}

export function businessDayLabel(pickupDate: string): string | null {
  const match = pickupDate.match(DATE_PATTERN);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return ZELOMENU_DAY_LABELS[date.getUTCDay()];
}
